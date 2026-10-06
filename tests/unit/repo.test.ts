import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { Dexie, type DBCore, type DBCoreMutateRequest, type DBCoreTable } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { nowWithOffset } from '../../src/data/clock.ts';
import { defaultSettings, TerrainDb, type Settings } from '../../src/data/db.ts';
import {
  campaignEvents,
  commitImport,
  loadLastCampaign,
  loadSettings,
  markHouse,
} from '../../src/data/repo.ts';
import { DEFAULT_STATUSES, railStatuses } from '../../src/domain/statuses.ts';
import type { Row, Status } from '../../src/domain/types.ts';
import { casesCampaign, freshDb, rowOf, storedRows } from '../support/campaign.ts';
import { importInto, NOW, parseFixture } from '../support/import.ts';

let db: TerrainDb;
function track(store: TerrainDb): TerrainDb {
  db = store;
  return store;
}
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('storage', () => {
  it('starts with the default statuses and no campaign', async () => {
    const store = track(freshDb());
    expect((await loadSettings(store)).statuses).toEqual(DEFAULT_STATUSES);
    expect(await loadLastCampaign(store)).toBeNull();
  });

  it('saves an import in one piece and opens it again as the last campaign', async () => {
    const store = track(freshDb());
    const plan = importInto(parseFixture('public/cases.kmz'));
    await commitImport(store, plan, 'e1', NOW);
    const loaded = await loadLastCampaign(store);
    expect(loaded?.campaign).toEqual(plan.campaign);
    expect(loaded?.rows).toEqual(plan.merge.rows);
    const events = await store.events.toArray();
    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.type !== 'import') throw new Error('Expected the import event');
    expect(event).toMatchObject({
      seq: 1,
      payload: { fileName: 'public/cases.kmz', absorbed: [] },
    });
    expect(event.payload.added).toHaveLength(28);
  });

  it('records previous values of a re-import, and finds the event by row', async () => {
    const store = track(freshDb());
    const first = importInto(parseFixture('public/cases.kmz'));
    await commitImport(store, first, 'e1', NOW);
    const renamed = importInto(parseFixture('public/cases-renamed.kmz'), first);
    await commitImport(store, renamed, 'e2', NOW);
    const jean = renamed.merge.rows.find((row) => row.parcelIdRaw === 'P1-240');
    const events = await store.events
      .where('rowIds')
      .equals(jean?.rowId ?? '')
      .toArray();
    expect(events.map((event) => [event.id, event.seq])).toEqual([
      ['e1', 1],
      ['e2', 2],
    ]);
    const [, second] = events;
    if (second?.type !== 'import') throw new Error('Expected the import event');
    expect(second.payload.changes).toContainEqual({
      rowId: jean?.rowId,
      column: 'NOM',
      previous: 'Trempoté',
      next: 'Trempette',
    });
    expect(await store.rows.count()).toBe(28);
  });

  it('changes nothing when the transaction fails', async () => {
    const store = track(freshDb());
    const plan = importInto(parseFixture('public/cases.kmz'));
    // An event id that already exists makes the last write of the transaction fail.
    await store.events.add({
      id: 'taken',
      campaignId: 'x',
      type: 'import',
      at: NOW,
      rowIds: [],
      houseKey: null,
      payload: {
        fileName: '',
        added: [],
        ownerDetailsChanged: [],
        missing: [],
        changes: [],
        absorbed: [],
      },
      exportedAt: null,
      seq: 1,
    });
    await expect(commitImport(store, plan, 'taken', NOW)).rejects.toThrow();
    expect(await store.campaigns.count()).toBe(0);
    expect(await store.rows.count()).toBe(0);
    expect((await loadSettings(store)).lastCampaignId).toBeNull();
  });
});

/** A database whose write of one row fails, as a full disk or a crash would. */
function faultyDb(): { store: TerrainDb; trap: { rowId: string | null } } {
  const trap: { rowId: string | null } = { rowId: null };
  const store = freshDb();
  store.use({
    stack: 'dbcore',
    name: 'fault-injection',
    create: (down: DBCore): DBCore => ({
      ...down,
      table: (name: string): DBCoreTable => {
        const table = down.table(name);
        return {
          ...table,
          mutate: (request: DBCoreMutateRequest) => {
            const values: readonly unknown[] = 'values' in request ? request.values : [];
            const hit = values.some(
              (value) => (value as Partial<Row> | null)?.rowId === trap.rowId,
            );
            return name === 'rows' && trap.rowId !== null && hit
              ? Promise.reject(new Error('Disk full'))
              : table.mutate(request);
          },
        };
      },
    }),
  });
  return { store, trap };
}

describe('a status tap that spreads across the lot', () => {
  it('changes nothing in any store when its transaction fails part-way', async () => {
    const { store, trap } = faultyDb();
    track(store);
    const plan = await casesCampaign(store);
    const campaignId = plan.campaign.id;
    const rows = await storedRows(store, campaignId);
    const events = await campaignEvents(store, campaignId);
    const settings = await loadSettings(store);
    const alain = rowOf(rows, 'P1-216B', 'Alain');
    // Luc's row at the other house fails, after the event was written.
    trap.rowId = rowOf(rows, 'P1-216B', 'Luc').rowId;
    await expect(
      markHouse(store, {
        campaignId,
        houseKey: alain.houseKey,
        statusId: 'given',
        eventId: 'tap-1',
        now: NOW,
      }),
    ).rejects.toThrow('Disk full');
    expect(await storedRows(store, campaignId)).toEqual(rows);
    expect(await campaignEvents(store, campaignId)).toEqual(events);
    expect(await loadSettings(store)).toEqual(settings);
  });
});

/** The database as version 1 created it. */
class Phase1Db extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      campaigns: 'id',
      rows: 'rowId, campaignId, [campaignId+houseKey]',
      events: 'id, campaignId, *rowIds, type, at',
      settings: 'key',
    });
  }
}

describe('the storage upgrade from version 1', () => {
  it('keeps the campaign, its rows and its import, adds the version 2 settings, and puts fixes per owner', async () => {
    const name = `terrain-test-${randomUUID()}`;
    const plan = importInto(parseFixture('public/cases.kmz'));
    const old = new Phase1Db(name);
    const phase1Rows = plan.merge.rows.map((row) => {
      const copy: Partial<Row> = { ...row };
      delete copy.importedStatusId;
      return copy;
    });
    const phase1Statuses = DEFAULT_STATUSES.filter((status) => status.id !== 'skipped').map(
      (status) => {
        const copy: Partial<Status> = { ...status };
        delete copy.notesLot;
        delete copy.onRail;
        return copy;
      },
    );
    // Version 1 put the address and home phone with the house; version 3 moves them to each owner.
    await old.table('campaigns').put({
      ...plan.campaign,
      columnGroups: {
        ...plan.campaign.columnGroups,
        ADRESSE: 'house',
        MUNICIPALITE: 'house',
        PROVINCE: 'house',
        CODE_POSTAL: 'house',
        TEL_RES: 'house',
      },
    });
    await old.table('rows').bulkPut(phase1Rows);
    await old.table('events').add({
      id: 'import-1',
      campaignId: plan.campaign.id,
      type: 'import',
      at: NOW,
      rowIds: plan.merge.added,
      houseKey: null,
      payload: {
        fileName: 'cases.kmz',
        added: plan.merge.added,
        ownerDetailsChanged: [],
        missing: [],
        changes: [],
      },
      exportedAt: null,
    });
    await old.table('settings').put({
      key: 'app',
      statuses: phase1Statuses,
      lastCampaignId: plan.campaign.id,
      storagePersisted: true,
    });
    old.close();

    const store = track(new TerrainDb(name));
    const loaded = await loadLastCampaign(store);
    expect(loaded?.campaign).toEqual(plan.campaign);
    expect(loaded?.rows).toEqual(plan.merge.rows);
    expect(await campaignEvents(store, plan.campaign.id)).toMatchObject([
      { id: 'import-1', seq: 1, payload: { absorbed: [] } },
    ]);
    const settings = await loadSettings(store);
    expect(settings).toMatchObject({
      lastCampaignId: plan.campaign.id,
      storagePersisted: true,
      dateFormat: 'DD.MM.YYYY HH:mm',
      fillVisitDateViaLot: true,
      notesExportMode: 'joined',
    });
    expect(settings.callOutcomes).toContain('Info good');
    expect(railStatuses(settings.statuses).map((status) => status.id)).toEqual([
      'given',
      'at-door',
      'to-research',
      'skipped',
    ]);
    expect(settings.statuses.find((status) => status.id === 'to-research')?.notesLot).toBe(true);
    expect(settings.statuses.find((status) => status.id === 'not-given')?.onRail).toBe(false);
    expect(settings).toMatchObject({ lookUpAddresses: true, onlineMap: true });
  });
});

/** The database as version 4 left it: before positions found from addresses and online switches. */
class Version4Db extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(4).stores({
      campaigns: 'id',
      rows: 'rowId, campaignId, [campaignId+houseKey], *lotKeys',
      events: 'id, campaignId, *rowIds, type, at, [campaignId+seq]',
      settings: 'key',
      pendingCalls: 'id, campaignId',
      basemaps: 'id',
    });
  }
}

describe('the storage upgrade from version 4', () => {
  it('keeps every row, marks no position as found from an address, and turns both online switches on', async () => {
    const name = `terrain-test-${randomUUID()}`;
    const plan = importInto(parseFixture('public/cases.kmz'));
    const old = new Version4Db(name);
    await old.table('campaigns').put(plan.campaign);
    await old.table('rows').bulkPut(
      plan.merge.rows.map((row) => {
        const copy: Partial<Row> = { ...row };
        delete copy.placed;
        return copy;
      }),
    );
    const version4Settings: Partial<Settings> = { ...defaultSettings() };
    delete version4Settings.lookUpAddresses;
    delete version4Settings.onlineMap;
    await old.table('settings').put({ ...version4Settings, lastCampaignId: plan.campaign.id });
    old.close();

    const store = track(new TerrainDb(name));
    const loaded = await loadLastCampaign(store);
    expect(loaded?.rows).toEqual(plan.merge.rows);
    expect(loaded?.rows.every((row) => row.placed === null)).toBe(true);
    expect(await loadSettings(store)).toMatchObject({ lookUpAddresses: true, onlineMap: true });
  });
});

describe('clock', () => {
  it('writes local time with its UTC offset', () => {
    expect(nowWithOffset(new Date(2026, 8, 26, 14, 32, 5))).toMatch(
      /^2026-09-26T14:32:05[+-]\d{2}:\d{2}$/,
    );
  });
});

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backupFileName,
  makeBackup,
  parseBackup,
  restoreBackup,
  RestoreError,
  type Backup,
} from '../../src/data/backup.ts';
import { SCHEMA_VERSION, TerrainDb } from '../../src/data/db.ts';
import {
  addNote,
  editFields,
  logCall,
  markHouse,
  moveHouse,
  startCall,
} from '../../src/data/repo.ts';
import { casesCampaign, freshDb, rowOf, storedRows } from '../support/campaign.ts';

const LATER = '2026-10-01T15:04:00-04:00';
const open: TerrainDb[] = [];
afterEach(async () => {
  for (const store of open.splice(0)) {
    store.close();
    await store.delete();
  }
});

function track(store: TerrainDb): TerrainDb {
  open.push(store);
  return store;
}

/** Every store of the database, each sorted by its key, as plain data. */
async function snapshot(store: TerrainDb) {
  const byKey = <T>(items: T[], key: (item: T) => string) =>
    [...items].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    campaigns: byKey(await store.campaigns.toArray(), (campaign) => campaign.id),
    rows: byKey(await store.rows.toArray(), (row) => row.rowId),
    events: byKey(await store.events.toArray(), (event) => event.id),
    settings: await store.settings.toArray(),
    pendingCalls: byKey(await store.pendingCalls.toArray(), (call) => call.id),
  };
}

/** A database with a bit of everything: an import, a Given across the lot, a correction, a move, a call, a note, a pending call. */
async function busyDb(): Promise<TerrainDb> {
  const store = track(freshDb());
  const plan = await casesCampaign(store);
  const campaignId = plan.campaign.id;
  const rows = await storedRows(store, campaignId);
  const alain = rowOf(rows, 'P1-216B', 'Alain');
  const houseKey = alain.houseKey;
  await markHouse(store, { campaignId, houseKey, statusId: 'given', eventId: 'e1', now: LATER });
  await editFields(store, {
    campaignId,
    houseKey,
    target: 'house',
    eventId: 'e2',
    now: LATER,
    writes: [{ rowIds: [alain.rowId], column: 'CELLULAIRE', value: '450 555-0124' }],
  });
  await moveHouse(store, {
    campaignId,
    houseKey,
    eventId: 'e3',
    now: LATER,
    position: { lat: 45.2642, lng: -73.6104 },
    accuracyM: 6,
  });
  await logCall(store, {
    campaignId,
    houseKey,
    eventId: 'e4',
    now: LATER,
    number: '450 555-0100',
    outcome: 'Info good',
    callDate: LATER,
    scope: 'number',
  });
  await addNote(store, {
    campaignId,
    houseKey,
    rowId: null,
    eventId: 'e5',
    now: LATER,
    text: 'Chien',
  });
  await startCall(store, {
    id: 'p1',
    campaignId,
    houseKey,
    number: '450 555-0100',
    startedAt: LATER,
  });
  return store;
}

describe('backup and restore', () => {
  it('reproduces the database exactly: back up, wipe, restore', async () => {
    const store = await busyDb();
    const before = await snapshot(store);
    const file = JSON.stringify(await makeBackup(store, LATER));
    store.close();
    await store.delete();

    const fresh = track(new TerrainDb(store.name));
    await restoreBackup(fresh, parseBackup(file));
    expect(await snapshot(fresh)).toEqual(before);
  });

  it('replaces whatever the device held', async () => {
    const source = await busyDb();
    const backup = await makeBackup(source, LATER);
    const target = track(freshDb());
    await casesCampaign(target);
    await restoreBackup(target, backup);
    expect(await snapshot(target)).toEqual(await snapshot(source));
  });

  it('restores a backup made before fixes went per owner, with address and phone moved to each owner', async () => {
    const store = await busyDb();
    const backup = await makeBackup(store, LATER);
    const older = {
      ...backup,
      schema: 2,
      campaigns: backup.campaigns.map((campaign) => ({
        ...campaign,
        columnGroups: { ...campaign.columnGroups, ADRESSE: 'house', TEL_RES: 'house' },
      })),
    };
    const parsed = parseBackup(JSON.stringify(older));
    expect(parsed.schema).toBe(SCHEMA_VERSION);
    expect(parsed.campaigns.map((campaign) => campaign.columnGroups)).toEqual(
      backup.campaigns.map((campaign) => campaign.columnGroups),
    );
  });

  it('restores a backup made before positions from addresses, with both online switches on', async () => {
    const store = await busyDb();
    const backup = await makeBackup(store, LATER);
    const older = {
      ...backup,
      schema: 4,
      rows: backup.rows.map((row) => {
        const copy: Partial<typeof row> = { ...row };
        delete copy.placed;
        return copy;
      }),
      settings: backup.settings.map((saved) => {
        const copy: Partial<typeof saved> = { ...saved };
        delete copy.lookUpAddresses;
        delete copy.onlineMap;
        return copy;
      }),
    };
    const parsed = parseBackup(JSON.stringify(older));
    expect(parsed.schema).toBe(SCHEMA_VERSION);
    expect(parsed.rows).toEqual(backup.rows);
    expect(parsed.settings).toEqual(backup.settings);
  });

  it('restores a backup that linked by the parcel ID alone, linked by the lot number too', async () => {
    const store = await busyDb();
    const backup = await makeBackup(store, LATER);
    const older = {
      ...backup,
      schema: 5,
      rows: backup.rows.map((row) => ({
        ...row,
        lotKeys: row.lotKeys.map((key) => key.split('|')[0]),
      })),
    };
    expect(parseBackup(JSON.stringify(older)).rows).toEqual(backup.rows);
  });

  it('names the file Terrain_backup_<date>.json', () => {
    expect(backupFileName(LATER)).toBe('Terrain_backup_2026-10-01.json');
  });

  it.each<[string, string, string]>([
    ['text that isn’t JSON', 'P1-216B,Alain', 'not-a-backup'],
    ['another JSON file', '{"type":"FeatureCollection"}', 'not-a-backup'],
    [
      'a backup from a newer Terrain',
      '{"format":"terrain-backup","version":2,"schema":2,"createdAt":"x"}',
      'newer-backup',
    ],
    [
      'a backup missing its rows',
      '{"format":"terrain-backup","version":1,"schema":2,"createdAt":"x","campaigns":[],"events":[],"settings":[],"pendingCalls":[]}',
      'damaged-backup',
    ],
  ])('refuses %s', (_, text, code) => {
    expect(() => parseBackup(text)).toThrow(RestoreError);
    try {
      parseBackup(text);
    } catch (error) {
      expect(error instanceof RestoreError && error.code).toBe(code);
    }
  });

  it('changes nothing when a restore fails part-way', async () => {
    const store = await busyDb();
    const before = await snapshot(store);
    const backup = await makeBackup(store, LATER);
    // Two events with one id: the events write fails after campaigns and rows were written.
    const broken: Backup = { ...backup, events: [...backup.events, ...backup.events.slice(0, 1)] };
    await expect(restoreBackup(store, broken)).rejects.toThrow();
    expect(await snapshot(store)).toEqual(before);
  });
});

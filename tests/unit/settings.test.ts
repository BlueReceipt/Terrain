import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerrainDb } from '../../src/data/db.ts';
import {
  campaignEvents,
  commitImport,
  deleteCampaign,
  listCampaigns,
  loadLastCampaign,
  loadSettings,
  markHouse,
  pendingCalls,
  renameCampaign,
  saveSettings,
  setColumnGroups,
  setLotColumn,
  startCall,
  switchCampaign,
} from '../../src/data/repo.ts';
import { lotsAcrossHouses } from '../../src/domain/identity.ts';
import { initialColorMap, planImport } from '../../src/domain/importPlan.ts';
import {
  addStatus,
  DEFAULT_STATUSES,
  editStatus,
  isHexColor,
  lotBehaviorOf,
  lotFields,
  moveStatus,
  railStatuses,
} from '../../src/domain/statuses.ts';
import {
  casesCampaign,
  CO_OWNERS,
  freshDb,
  miniCampaign,
  rowOf,
  storedRows,
} from '../support/campaign.ts';
import { counter, NOW } from '../support/import.ts';

const rail = (statuses: Parameters<typeof railStatuses>[0]) =>
  railStatuses(statuses).map((status) => status.label);

describe('statuses in Settings', () => {
  it('says what a status does at the lot’s other addresses, and back', () => {
    const behaviors = DEFAULT_STATUSES.map((status) => [status.id, lotBehaviorOf(status)]);
    expect(Object.fromEntries(behaviors)).toEqual({
      'to-visit': 'house',
      given: 'closes',
      'at-door': 'house',
      'to-research': 'notes',
      skipped: 'house',
      'not-given': 'house',
    });
    for (const behavior of ['house', 'closes', 'notes'] as const)
      expect(lotBehaviorOf(lotFields(behavior))).toBe(behavior);
  });

  it('takes colors as #RRGGBB, the way My Maps writes them', () => {
    for (const color of ['#0F9D58', '#0f9d58', ' #FFEA00 ']) expect(isHexColor(color)).toBe(true);
    for (const color of ['0F9D58', '#0F9D5', '#GG0000', '', 'green'])
      expect(isHexColor(color)).toBe(false);
  });

  it('edits a status, and To visit keeps its part whatever the form sends', () => {
    const edited = editStatus(DEFAULT_STATUSES, 'skipped', {
      label: 'Absent',
      color: '#7b1fa2',
      packageStatusText: 'Absent',
      asksForNote: true,
    });
    expect(edited.find((status) => status.id === 'skipped')).toMatchObject({
      label: 'Absent',
      color: '#7B1FA2',
      packageStatusText: 'Absent',
      asksForNote: true,
      onRail: true,
    });
    expect(edited.filter((status) => status.id !== 'skipped')).toEqual(
      DEFAULT_STATUSES.filter((status) => status.id !== 'skipped'),
    );

    const start = editStatus(DEFAULT_STATUSES, 'to-visit', {
      label: 'À visiter',
      color: '#1f6fd1',
      onRail: true,
      archived: true,
      scope: 'lot',
    });
    expect(start.find((status) => status.id === 'to-visit')).toEqual({
      ...DEFAULT_STATUSES[0],
      label: 'À visiter',
      color: '#1F6FD1',
    });
  });

  it('adds a status last on the rail, moves statuses along it, and archives one off it', () => {
    const added = addStatus(DEFAULT_STATUSES, 'callback', 'Callback', '#f57c00');
    expect(rail(added)).toEqual(['Given', 'At door', 'To research', 'Skipped', 'Callback']);
    expect(added.at(-1)).toMatchObject({
      color: '#F57C00',
      packageStatusText: 'Callback',
      scope: 'house',
      replaceableByLot: true,
      notesLot: false,
    });

    // Settings lists every status: one step up passes Not given, off the rail; the next passes Skipped.
    const passed = moveStatus(added, 'callback', -1);
    expect(rail(passed)).toEqual(rail(added));
    const moved = moveStatus(passed, 'callback', -1);
    expect(rail(moved)).toEqual(['Given', 'At door', 'To research', 'Callback', 'Skipped']);
    expect(moved.map((status) => status.order)).toEqual(moved.map((_, i) => i));
    // Nothing above the first, nothing below the last.
    expect(moveStatus(moved, 'to-visit', -1)).toEqual(moved);
    expect(moveStatus(moved, 'not-given', 1)).toEqual(moved);

    const archived = editStatus(moved, 'at-door', { archived: true });
    expect(rail(archived)).toEqual(['Given', 'To research', 'Callback', 'Skipped']);
  });
});

let db: TerrainDb | undefined;
afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

/** The test's database, once a test has opened one. */
function store(): TerrainDb {
  if (!db) throw new Error('No database');
  return db;
}

/** The cases fixture, then a second campaign a day later (the restaurant list's co-owners). */
async function twoCampaigns() {
  db = freshDb();
  const cases = await casesCampaign(store());
  // Its own IDs: the test counters would give both campaigns the same ones.
  const { parsed } = miniCampaign(CO_OWNERS);
  const day2 = '2026-09-27T09:00:00-04:00';
  const plan = planImport({
    parsed,
    campaign: null,
    existingRows: [],
    statuses: DEFAULT_STATUSES,
    roles: parsed.roles,
    colorMap: initialColorMap(parsed, DEFAULT_STATUSES).colorMap,
    lotColumn: null,
    now: day2,
    newId: counter('s'),
  });
  await commitImport(store(), plan, 'import-2', day2);
  return { cases: cases.campaign.id, second: plan.campaign.id };
}

describe('campaigns and settings, saved', () => {
  it('saves only what changed in Settings', async () => {
    db = freshDb();
    const before = await loadSettings(store());
    await saveSettings(store(), {
      callOutcomes: ['Info good', 'Rappeler'],
      dateFormat: 'YYYY-MM-DD HH:mm',
    });
    expect(await loadSettings(store())).toEqual({
      ...before,
      callOutcomes: ['Info good', 'Rappeler'],
      dateFormat: 'YYYY-MM-DD HH:mm',
    });
  });

  it('lists the campaigns newest first, switches, renames', async () => {
    const { cases, second } = await twoCampaigns();
    const listed = await listCampaigns(store());
    expect(listed.map(({ id, rows }) => ({ id, rows }))).toEqual([
      { id: second, rows: 2 },
      { id: cases, rows: (await storedRows(store(), cases)).length },
    ]);
    // The newest import opened last; switching makes the other one open on launch.
    expect((await loadLastCampaign(store()))?.campaign.id).toBe(second);
    await switchCampaign(store(), cases);
    expect((await loadLastCampaign(store()))?.campaign.id).toBe(cases);
    await renameCampaign(store(), cases, 'Zone 3 nord');
    expect((await listCampaigns(store())).find((campaign) => campaign.id === cases)?.name).toBe(
      'Zone 3 nord',
    );
  });

  it('deletes a campaign and everything in it, and nothing of the others', async () => {
    const { cases, second } = await twoCampaigns();
    await switchCampaign(store(), cases);
    const rows = await storedRows(store(), cases);
    const alain = rowOf(rows, 'P1-216B', 'Alain');
    await markHouse(store(), {
      campaignId: cases,
      houseKey: alain.houseKey,
      statusId: 'given',
      eventId: 'tap',
      now: NOW,
    });
    await startCall(store(), {
      id: 'call',
      campaignId: cases,
      houseKey: alain.houseKey,
      number: '450 555-0100',
      startedAt: NOW,
    });
    const secondRows = await storedRows(store(), second);
    const secondEvents = await campaignEvents(store(), second);

    expect(await deleteCampaign(store(), cases)).toBe(second);
    expect(await storedRows(store(), cases)).toEqual([]);
    expect(await campaignEvents(store(), cases)).toEqual([]);
    expect(await pendingCalls(store(), cases)).toEqual([]);
    expect(await storedRows(store(), second)).toEqual(secondRows);
    expect(await campaignEvents(store(), second)).toEqual(secondEvents);
    expect((await loadLastCampaign(store()))?.campaign.id).toBe(second);

    expect(await deleteCampaign(store(), second)).toBeNull();
    expect(await loadLastCampaign(store())).toBeNull();
    expect(await listCampaigns(store())).toEqual([]);
  });

  it('regroups lots by another column at once, and back', async () => {
    db = freshDb();
    const plan = await casesCampaign(store());
    const id = plan.campaign.id;
    const byParcel = lotsAcrossHouses(await storedRows(store(), id))
      .map((lot) => lot.lotKey)
      .sort();
    expect(byParcel).toContain('P1-216B');

    const loaded = await setLotColumn(store(), id, 'NUM_LOT');
    expect(loaded.campaign.lotColumn).toBe('NUM_LOT');
    const stored = await storedRows(store(), id);
    expect(stored).toEqual(loaded.rows);
    expect(
      lotsAcrossHouses(stored)
        .map((lot) => lot.lotKey)
        .sort(),
    ).toEqual(['1234500', '1234567']);

    await setLotColumn(store(), id, null);
    expect(
      lotsAcrossHouses(await storedRows(store(), id))
        .map((lot) => lot.lotKey)
        .sort(),
    ).toEqual(byParcel);
  });

  it('saves how Edit info groups the columns', async () => {
    db = freshDb();
    const plan = await casesCampaign(store());
    const groups = { ...plan.campaign.columnGroups, TEL_RES: 'house' as const };
    const campaign = await setColumnGroups(store(), plan.campaign.id, groups);
    expect(campaign.columnGroups.TEL_RES).toBe('house');
    expect((await loadLastCampaign(store()))?.campaign.columnGroups.TEL_RES).toBe('house');
  });
});

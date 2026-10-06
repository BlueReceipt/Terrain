import { Dexie } from 'dexie';
import {
  planCall,
  planEdit,
  planMove,
  planNote,
  planNoteDeletion,
  planUndo,
  type EditWrite,
} from '../domain/actions.ts';
import { phoneColumns, rowsListingNumber } from '../domain/calls.ts';
import {
  undoable,
  undoneIds,
  type ImportEvent,
  type NewOwner,
  type TerrainEvent,
} from '../domain/events.ts';
import { lotNumberColumns } from '../domain/identity.ts';
import { boundsOf, type ImportPlan } from '../domain/importPlan.ts';
import { planStatusChange } from '../domain/lots.ts';
import { applyIdentity } from '../domain/rows.ts';
import type { Campaign, LatLng, Row } from '../domain/types.ts';
import {
  defaultSettings,
  type PendingCall,
  type Settings,
  type StoredEvent,
  type TerrainDb,
} from './db.ts';

export interface LoadedCampaign {
  campaign: Campaign;
  rows: Row[];
}

/** What an action saved: its event, and every row it changed (rows regrouped into houses included). */
export interface ActionResult {
  event: StoredEvent;
  rows: Row[];
  /** The campaign, when the action changed it (the first New owner adds Previous info). */
  campaign?: Campaign;
}

export async function loadSettings(db: TerrainDb): Promise<Settings> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  const fresh = defaultSettings();
  await db.settings.put(fresh);
  return fresh;
}

export async function loadCampaign(
  db: TerrainDb,
  campaignId: string,
): Promise<LoadedCampaign | null> {
  const campaign = await db.campaigns.get(campaignId);
  if (!campaign) return null;
  const rows = await db.rows.where('campaignId').equals(campaignId).sortBy('rowIndex');
  return { campaign, rows };
}

/** The last-used campaign opens on launch. */
export async function loadLastCampaign(db: TerrainDb): Promise<LoadedCampaign | null> {
  const { lastCampaignId } = await loadSettings(db);
  return lastCampaignId === null ? null : loadCampaign(db, lastCampaignId);
}

function ofCampaign(db: TerrainDb, campaignId: string) {
  return db.events
    .where('[campaignId+seq]')
    .between([campaignId, Dexie.minKey], [campaignId, Dexie.maxKey]);
}

/** A campaign's events, in the order they happened. */
export async function campaignEvents(db: TerrainDb, campaignId: string): Promise<StoredEvent[]> {
  return ofCampaign(db, campaignId).toArray();
}

/** Appends an event after the campaign's last one. Call inside the action's transaction. */
async function append(db: TerrainDb, event: TerrainEvent): Promise<StoredEvent> {
  const last = await ofCampaign(db, event.campaignId).last();
  const stored: StoredEvent = { ...event, seq: (last?.seq ?? 0) + 1 };
  await db.events.add(stored);
  return stored;
}

export function importEventOf(plan: ImportPlan, eventId: string, at: string): ImportEvent {
  const { merge } = plan;
  const touched = new Set([...merge.added, ...merge.updated, ...merge.missing]);
  return {
    id: eventId,
    campaignId: plan.campaign.id,
    type: 'import',
    at,
    rowIds: [...touched],
    houseKey: null,
    payload: {
      fileName: plan.parsed.fileName,
      added: merge.added,
      ownerDetailsChanged: merge.ownerDetailsChanged,
      missing: merge.missing,
      changes: merge.changes,
      absorbed: merge.absorbed,
    },
    exportedAt: null,
  };
}

/** Saves an import in one transaction: the campaign, every row and the import event, or nothing. */
export async function commitImport(
  db: TerrainDb,
  plan: ImportPlan,
  eventId: string,
  at: string,
): Promise<LoadedCampaign> {
  await db.transaction('rw', [db.campaigns, db.rows, db.events, db.settings], async () => {
    await db.campaigns.put(plan.campaign);
    await db.rows.bulkPut(plan.merge.rows);
    await append(db, importEventOf(plan, eventId, at));
    const settings = await loadSettings(db);
    await db.settings.put({ ...settings, lastCampaignId: plan.campaign.id });
  });
  return { campaign: plan.campaign, rows: plan.merge.rows };
}

export async function recordStoragePersistence(db: TerrainDb, persisted: boolean): Promise<void> {
  const settings = await loadSettings(db);
  await db.settings.put({ ...settings, storagePersisted: persisted });
}

async function campaignOf(db: TerrainDb, campaignId: string): Promise<Campaign> {
  const campaign = await db.campaigns.get(campaignId);
  if (!campaign) throw new Error(`No campaign ${campaignId}`);
  return campaign;
}

async function houseRows(db: TerrainDb, campaignId: string, houseKey: string): Promise<Row[]> {
  return db.rows.where('[campaignId+houseKey]').equals([campaignId, houseKey]).sortBy('rowIndex');
}

function isRow(row: Row | undefined): row is Row {
  return row !== undefined;
}

/**
 * Whether saved corrections can move rows between houses or lots: address, lot column (or, by
 * default, the lot number that goes with the row ID), position.
 */
function changesIdentity(campaign: Campaign, event: TerrainEvent): boolean {
  if (event.type !== 'fields_edited') return false;
  if (event.payload.location) return true;
  const { roles } = campaign;
  const columns = new Set([
    roles.street,
    roles.town,
    roles.province,
    roles.postalCode,
    ...(campaign.lotColumn === null
      ? lotNumberColumns(campaign.columnOrder)
      : [campaign.lotColumn]),
  ]);
  return event.payload.changes.some((change) => columns.has(change.column));
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/**
 * Writes the changed rows. After a correction to an address, the lot column or a position, houses
 * and lots are recomputed for the whole campaign, and rows that changed house or lot are written too.
 */
async function saveRows(
  db: TerrainDb,
  campaign: Campaign,
  changed: readonly Row[],
  regroup: boolean,
): Promise<Row[]> {
  if (!regroup) {
    await db.rows.bulkPut([...changed]);
    return [...changed];
  }
  const before = await db.rows.where('campaignId').equals(campaign.id).toArray();
  const byId = new Map(changed.map((row) => [row.rowId, row]));
  const { rows } = applyIdentity(
    before.map((row) => byId.get(row.rowId) ?? row),
    campaign,
  );
  const old = new Map(before.map((row) => [row.rowId, row]));
  const written = rows.filter((row) => {
    const was = old.get(row.rowId);
    return (
      byId.has(row.rowId) ||
      !was ||
      was.houseKey !== row.houseKey ||
      !sameKeys(was.lotKeys, row.lotKeys)
    );
  });
  await db.rows.bulkPut(written);
  const bounds = boundsOf(rows);
  if (JSON.stringify(bounds) !== JSON.stringify(campaign.bounds)) {
    await db.campaigns.put({ ...campaign, bounds });
  }
  return written;
}

const ACTION_TABLES = (db: TerrainDb) => [db.campaigns, db.rows, db.events, db.settings];

interface StatusTap {
  campaignId: string;
  statusId: string;
  eventId: string;
  now: string;
}

async function markRows(
  db: TerrainDb,
  tap: StatusTap & { houseKey: string },
  targets: Row[],
  target: 'house' | 'row',
): Promise<ActionResult | null> {
  const campaign = await campaignOf(db, tap.campaignId);
  const settings = await loadSettings(db);
  const lotKeys = [...new Set(targets.flatMap((row) => row.lotKeys))];
  const lotRows =
    lotKeys.length === 0
      ? []
      : await db.rows
          .where('lotKeys')
          .anyOf(lotKeys)
          .distinct()
          .filter((row) => row.campaignId === tap.campaignId)
          .toArray();
  const planned = planStatusChange({
    eventId: tap.eventId,
    campaignId: tap.campaignId,
    now: tap.now,
    houseKey: tap.houseKey,
    target,
    targetRows: targets,
    lotRowsElsewhere: lotRows,
    statuses: settings.statuses,
    statusId: tap.statusId,
    roles: campaign.roles,
    fillVisitDateViaLot: settings.fillVisitDateViaLot,
  });
  if (!planned) return null;
  const event = await append(db, planned.event);
  await db.rows.bulkPut(planned.rows);
  return { event, rows: planned.rows };
}

/** A status tap on the house rail: every row at the house, and the lot for a whole-lot status. */
export async function markHouse(
  db: TerrainDb,
  tap: StatusTap & { houseKey: string },
): Promise<ActionResult | null> {
  return db.transaction('rw', ACTION_TABLES(db), async () => {
    const targets = await houseRows(db, tap.campaignId, tap.houseKey);
    if (targets.length === 0) throw new Error(`No house ${tap.houseKey}`);
    return markRows(db, tap, targets, 'house');
  });
}

/** "This row only". */
export async function markRow(
  db: TerrainDb,
  tap: StatusTap & { rowId: string },
): Promise<ActionResult | null> {
  return db.transaction('rw', ACTION_TABLES(db), async () => {
    const row = await db.rows.get(tap.rowId);
    if (row?.campaignId !== tap.campaignId) throw new Error(`No row ${tap.rowId}`);
    return markRows(db, { ...tap, houseKey: row.houseKey }, [row], 'row');
  });
}

interface HouseAction {
  campaignId: string;
  houseKey: string;
  eventId: string;
  now: string;
}

/**
 * Edit info or Edit this row, saved: one event, every changed row and field. A write in a column
 * the campaign doesn't have yet (Previous info, after New owner) adds it at the end, per owner.
 */
export async function editFields(
  db: TerrainDb,
  edit: HouseAction & {
    target: 'house' | 'row';
    writes: readonly EditWrite[];
    newOwners?: readonly NewOwner[];
  },
): Promise<ActionResult | null> {
  return db.transaction('rw', ACTION_TABLES(db), async () => {
    let campaign = await campaignOf(db, edit.campaignId);
    const rows = await houseRows(db, edit.campaignId, edit.houseKey);
    const planned = planEdit({ ...edit, rows });
    if (!planned) return null;
    const added = [...new Set(planned.event.payload.changes.map((change) => change.column))].filter(
      (column) => !campaign.columnOrder.includes(column),
    );
    if (added.length > 0) {
      campaign = {
        ...campaign,
        columnOrder: [...campaign.columnOrder, ...added],
        columnGroups: {
          ...campaign.columnGroups,
          ...Object.fromEntries(added.map((column) => [column, 'person' as const])),
        },
      };
      await db.campaigns.put(campaign);
    }
    const event = await append(db, planned.event);
    const saved = await saveRows(db, campaign, planned.rows, changesIdentity(campaign, event));
    return { event, rows: saved, ...(added.length > 0 ? { campaign } : {}) };
  });
}

/** "Use my location for this house": how a house with no position gets its pin at the door. */
export async function moveHouse(
  db: TerrainDb,
  move: HouseAction & { position: LatLng; accuracyM: number | null },
): Promise<ActionResult | null> {
  return db.transaction('rw', ACTION_TABLES(db), async () => {
    const campaign = await campaignOf(db, move.campaignId);
    const rows = await houseRows(db, move.campaignId, move.houseKey);
    const planned = planMove({ ...move, rows });
    if (!planned) return null;
    const event = await append(db, planned.event);
    const saved = await saveRows(db, campaign, planned.rows, true);
    return { event, rows: saved };
  });
}

/**
 * A call outcome: Call date and call result on every row at the house listing the number.
 * A number no row lists (Log call → Whole house) logs on the whole house.
 */
export async function logCall(
  db: TerrainDb,
  call: HouseAction & {
    number: string;
    outcome: string;
    callDate: string;
    scope: 'number' | 'house';
  },
): Promise<ActionResult> {
  return db.transaction('rw', ACTION_TABLES(db), async () => {
    const campaign = await campaignOf(db, call.campaignId);
    const rows = await houseRows(db, call.campaignId, call.houseKey);
    const listing =
      call.scope === 'number'
        ? rowsListingNumber(rows, call.number, phoneColumns(campaign.columnOrder, campaign.roles))
        : [];
    const byNumber = listing.length > 0;
    const planned = planCall({
      ...call,
      rows: byNumber ? listing : rows,
      scope: byNumber ? 'number' : 'house',
    });
    const event = await append(db, planned.event);
    await db.rows.bulkPut(planned.rows);
    return { event, rows: planned.rows };
  });
}

/** Tapping a number: stored before the dialer opens, so its outcome can be asked on return. */
export async function startCall(
  db: TerrainDb,
  call: Omit<PendingCall, 'rowIds'>,
): Promise<PendingCall> {
  return db.transaction('rw', [db.campaigns, db.rows, db.pendingCalls], async () => {
    const campaign = await campaignOf(db, call.campaignId);
    const rows = await houseRows(db, call.campaignId, call.houseKey);
    const listing = rowsListingNumber(
      rows,
      call.number,
      phoneColumns(campaign.columnOrder, campaign.roles),
    );
    const pending: PendingCall = { ...call, rowIds: listing.map((row) => row.rowId) };
    await db.pendingCalls.put(pending);
    return pending;
  });
}

export async function pendingCalls(db: TerrainDb, campaignId: string): Promise<PendingCall[]> {
  return db.pendingCalls.where('campaignId').equals(campaignId).sortBy('startedAt');
}

/** The outcome of a pending call: logged with the time the call started, and the pending call cleared. */
export async function resolveCall(
  db: TerrainDb,
  answer: { pendingId: string; outcome: string; eventId: string; now: string },
): Promise<ActionResult | null> {
  return db.transaction(
    'rw',
    [db.campaigns, db.rows, db.events, db.settings, db.pendingCalls],
    async () => {
      const call = await db.pendingCalls.get(answer.pendingId);
      if (!call) return null;
      const listed = (await db.rows.bulkGet(call.rowIds)).filter(isRow);
      const rows = listed.length > 0 ? listed : await houseRows(db, call.campaignId, call.houseKey);
      const planned = planCall({
        eventId: answer.eventId,
        campaignId: call.campaignId,
        now: answer.now,
        houseKey: call.houseKey,
        rows,
        number: call.number,
        outcome: answer.outcome,
        callDate: call.startedAt,
        scope: listed.length > 0 ? 'number' : 'house',
      });
      const event = await append(db, planned.event);
      await db.rows.bulkPut(planned.rows);
      await db.pendingCalls.delete(call.id);
      return { event, rows: planned.rows };
    },
  );
}

export async function discardCall(db: TerrainDb, pendingId: string): Promise<void> {
  await db.pendingCalls.delete(pendingId);
}

/** A note for every row at the house, or for one row. */
export async function addNote(
  db: TerrainDb,
  note: HouseAction & { rowId: string | null; text: string },
): Promise<StoredEvent | null> {
  return db.transaction('rw', [db.rows, db.events], async () => {
    const rowIds =
      note.rowId !== null
        ? [note.rowId]
        : (await houseRows(db, note.campaignId, note.houseKey)).map((row) => row.rowId);
    const event = planNote({ ...note, rowIds, target: note.rowId !== null ? 'row' : 'house' });
    return event ? append(db, event) : null;
  });
}

/** Deleting a note (after Alex confirms): a deletion event; the note stays in the log. */
export async function deleteNote(
  db: TerrainDb,
  deletion: { campaignId: string; noteEventId: string; eventId: string; now: string },
): Promise<StoredEvent | null> {
  return db.transaction('rw', [db.events], async () => {
    const events = await campaignEvents(db, deletion.campaignId);
    const note = events.find((event) => event.id === deletion.noteEventId);
    if (note?.type !== 'note_added') throw new Error(`No note ${deletion.noteEventId}`);
    const undone = undoneIds(events);
    const gone =
      undone.has(note.id) ||
      events.some(
        (event) =>
          event.type === 'note_deleted' &&
          event.payload.noteEventId === note.id &&
          !undone.has(event.id),
      );
    if (gone) return null;
    return append(db, planNoteDeletion({ ...deletion, note }));
  });
}

/**
 * The toast's Undo: takes back the campaign's last action, if it is still the last one.
 * Returns null when it isn't (another action came after it) or when there is nothing to undo.
 */
export async function undo(
  db: TerrainDb,
  request: { campaignId: string; undoneEventId: string; eventId: string; now: string },
): Promise<ActionResult | null> {
  return db.transaction('rw', ACTION_TABLES(db), async () => {
    const last = await ofCampaign(db, request.campaignId).last();
    const target = last ? undoable([last]) : null;
    if (target?.id !== request.undoneEventId) return null;
    const campaign = await campaignOf(db, request.campaignId);
    const rows = (await db.rows.bulkGet(target.rowIds)).filter(isRow);
    const planned = planUndo({ ...request, undone: target, rows });
    const event = await append(db, planned.event);
    const saved = await saveRows(db, campaign, planned.rows, changesIdentity(campaign, target));
    return { event, rows: saved };
  });
}

/**
 * "N changes not exported yet": actions since the last export. An undo counts only when the
 * client already received what it took back.
 */
export async function notExportedCount(db: TerrainDb, campaignId: string): Promise<number> {
  const events = await campaignEvents(db, campaignId);
  const undone = undoneIds(events);
  const byId = new Map(events.map((event) => [event.id, event]));
  return events.filter((event) => {
    if (event.exportedAt !== null || event.type === 'import') return false;
    if (event.type === 'undo') return byId.get(event.payload.undoneEventId)?.exportedAt != null;
    return !undone.has(event.id);
  }).length;
}

/** After an Excel, CSV or JSON export: everything so far counts as exported. */
export async function markExported(db: TerrainDb, campaignId: string, at: string): Promise<void> {
  await db.events
    .where('campaignId')
    .equals(campaignId)
    .filter((event) => event.exportedAt === null)
    .modify({ exportedAt: at });
}

type EditableSettings = Pick<
  Settings,
  'statuses' | 'callOutcomes' | 'dateFormat' | 'notesExportMode' | 'fillVisitDateViaLot'
>;

/** A change made in Settings: statuses, call outcomes, dates, notes in export, lots. */
export async function saveSettings(
  db: TerrainDb,
  change: Partial<EditableSettings>,
): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const next = { ...(await loadSettings(db)), ...change };
    await db.settings.put(next);
    return next;
  });
}

export interface CampaignSummary {
  id: string;
  name: string;
  createdAt: string;
  rows: number;
}

/** Every campaign on the phone, newest first. */
export async function listCampaigns(db: TerrainDb): Promise<CampaignSummary[]> {
  const campaigns = await db.campaigns.toArray();
  const summaries = await Promise.all(
    campaigns.map(async (campaign) => ({
      id: campaign.id,
      name: campaign.name,
      createdAt: campaign.createdAt,
      rows: await db.rows.where('campaignId').equals(campaign.id).count(),
    })),
  );
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Opens another campaign; it is the one that opens on launch from now on. */
export async function switchCampaign(
  db: TerrainDb,
  campaignId: string,
): Promise<LoadedCampaign | null> {
  return db.transaction('rw', [db.campaigns, db.rows, db.settings], async () => {
    const loaded = await loadCampaign(db, campaignId);
    if (loaded) await db.settings.put({ ...(await loadSettings(db)), lastCampaignId: campaignId });
    return loaded;
  });
}

export async function renameCampaign(
  db: TerrainDb,
  campaignId: string,
  name: string,
): Promise<Campaign> {
  return db.transaction('rw', db.campaigns, async () => {
    const campaign = { ...(await campaignOf(db, campaignId)), name };
    await db.campaigns.put(campaign);
    return campaign;
  });
}

/**
 * Deletes a campaign and everything in it, after Alex confirms: rows, events, waiting calls.
 * Returns the campaign that opens on launch now: the newest one left, or none.
 */
export async function deleteCampaign(db: TerrainDb, campaignId: string): Promise<string | null> {
  return db.transaction(
    'rw',
    [db.campaigns, db.rows, db.events, db.pendingCalls, db.settings],
    async () => {
      await db.rows.where('campaignId').equals(campaignId).delete();
      await db.events.where('campaignId').equals(campaignId).delete();
      await db.pendingCalls.where('campaignId').equals(campaignId).delete();
      await db.campaigns.delete(campaignId);
      const settings = await loadSettings(db);
      let next = settings.lastCampaignId;
      if (next === campaignId || next === null) {
        const left = await db.campaigns.toArray();
        next = left.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? null;
      }
      await db.settings.put({ ...settings, lastCampaignId: next });
      return next;
    },
  );
}

/** Settings → Columns: which columns Edit info shows once per house, parcel or owner. */
export async function setColumnGroups(
  db: TerrainDb,
  campaignId: string,
  columnGroups: Campaign['columnGroups'],
): Promise<Campaign> {
  return db.transaction('rw', db.campaigns, async () => {
    const campaign = { ...(await campaignOf(db, campaignId)), columnGroups };
    await db.campaigns.put(campaign);
    return campaign;
  });
}

/**
 * Settings → Lots: rows grouped into lots by another column. Every row's lots and houses are
 * recomputed in one transaction; past events keep what they did.
 */
export async function setLotColumn(
  db: TerrainDb,
  campaignId: string,
  lotColumn: string | null,
): Promise<LoadedCampaign> {
  return db.transaction('rw', [db.campaigns, db.rows], async () => {
    const campaign = { ...(await campaignOf(db, campaignId)), lotColumn };
    const rows = await db.rows.where('campaignId').equals(campaignId).sortBy('rowIndex');
    const regrouped = applyIdentity(rows, campaign).rows;
    await db.rows.bulkPut(regrouped);
    await db.campaigns.put(campaign);
    return { campaign, rows: regrouped };
  });
}

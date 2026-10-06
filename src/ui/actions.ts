import { signal } from '@preact/signals';
import { ulid } from 'ulid';
import { nowWithOffset } from '../data/clock.ts';
import type { PendingCall, TerrainDb } from '../data/db.ts';
import {
  addNote,
  deleteNote,
  discardCall,
  editFields,
  logCall,
  markHouse,
  markRow,
  moveHouse,
  pendingCalls,
  resolveCall,
  startCall,
  undo,
  type ActionResult,
} from '../data/repo.ts';
import type { EditWrite } from '../domain/actions.ts';
import { PENDING_CALL_MINUTES, type HouseNumber } from '../domain/calls.ts';
import type { NewOwner } from '../domain/events.ts';
import { boundsOf } from '../domain/importPlan.ts';
import { startStatus } from '../domain/statuses.ts';
import type { LatLng } from '../domain/types.ts';
import { openDialer } from './dialer.ts';
import { current, database, events, statuses } from './flow.ts';
import { addressOf } from './rowText.ts';
import { selectedHouseKey, sheet } from './mapState.ts';
import { strings } from './strings.ts';

export interface Toast {
  id: number;
  message: string;
  /** The event the Undo button takes back; null when there is nothing to undo. */
  undoEventId: string | null;
}

/** The toast: visible until the next action or 6 seconds. */
export const toast = signal<Toast | null>(null);
/** Calls dialed from Terrain whose outcome isn't logged yet. */
export const pending = signal<PendingCall[]>([]);

let toastCount = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function say(message: string, undoEventId: string | null = null): void {
  clearTimeout(toastTimer);
  toast.value = { id: ++toastCount, message, undoEventId };
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 6000);
}

/** A toast without Undo: an export, a copy. */
export function notify(message: string): void {
  say(message);
}

/** A short tap of the motor, where the phone has one. */
function buzz(): void {
  if ('vibrate' in navigator) navigator.vibrate(12);
}

/** The changed rows into the open campaign and the event into its log; the card follows its house. */
function apply(result: ActionResult): void {
  const loaded = current.value;
  if (!loaded) return;
  const changed = new Map(result.rows.map((row) => [row.rowId, row]));
  const selected = selectedHouseKey.value;
  const follow = loaded.rows.find((row) => row.houseKey === selected);
  const rows = loaded.rows.map((row) => changed.get(row.rowId) ?? row);
  current.value = {
    campaign: { ...(result.campaign ?? loaded.campaign), bounds: boundsOf(rows) },
    rows,
  };
  events.value = [...events.value, result.event];
  // A corrected address can give the house a new key: keep its card open.
  if (selected && follow && !rows.some((row) => row.houseKey === selected)) {
    selectedHouseKey.value = rows.find((row) => row.rowId === follow.rowId)?.houseKey ?? null;
  }
}

interface ActionContext {
  campaignId: string;
  eventId: string;
  now: string;
}

/** Runs an action; a failed save changes nothing and says so. */
async function run<T>(
  action: (db: TerrainDb, context: ActionContext) => Promise<T>,
): Promise<T | null> {
  const db = database();
  const loaded = current.value;
  if (!db || !loaded) return null;
  try {
    return await action(db, {
      campaignId: loaded.campaign.id,
      eventId: ulid(),
      now: nowWithOffset(),
    });
  } catch {
    say(strings.toast.notSaved);
    return null;
  }
}

function placeOf(houseKey: string): string {
  const loaded = current.value;
  if (!loaded) return '';
  return addressOf(
    loaded.rows.filter((row) => row.houseKey === houseKey),
    loaded.campaign.roles,
  );
}

function statusToast(result: ActionResult, houseKey: string): string {
  const loaded = current.value;
  const event = result.event;
  if (!loaded || event.type !== 'status_set') return '';
  const status = statuses.value.find((candidate) => candidate.id === event.payload.statusId);
  const label = status?.label ?? '';
  const written = event.payload.writtenRowIds;
  const elsewhere = event.payload.lotAffected;
  const closed = elsewhere.filter((affected) => affected.statusChanged).map((a) => a.rowId);
  const houseOf = (rowId: string) => loaded.rows.find((row) => row.rowId === rowId)?.houseKey ?? '';
  const otherHouses = [...new Set(elsewhere.map((affected) => houseOf(affected.rowId)))];
  let message =
    event.payload.target === 'row' || written.length === 1
      ? strings.toast.rowMarked(
          loaded.rows.find((row) => row.rowId === written[0])?.parcelIdRaw.trim() ?? '',
          label,
        )
      : strings.toast.houseMarked(label, written.length, placeOf(houseKey));
  if (closed.length > 0)
    message += strings.toast.alsoClosed(
      closed.length,
      otherHouses.length === 1 ? placeOf(otherHouses[0] ?? '') : null,
      otherHouses.length,
    );
  else if (elsewhere.length > 0 && event.payload.lot?.mode === 'note')
    message += strings.toast.alsoNoted(otherHouses.length);
  return message;
}

/** A status tap on the house rail. A status that asks for a note opens the editor after. */
export async function tapHouseStatus(houseKey: string, statusId: string): Promise<void> {
  buzz();
  const result = await run((db, context) => markHouse(db, { ...context, houseKey, statusId }));
  if (!result) return;
  apply(result);
  say(statusToast(result, houseKey), result.event.id);
  if (statuses.value.find((status) => status.id === statusId)?.asksForNote)
    sheet.value = { kind: 'note', houseKey, rowId: null };
}

/** "This row only". */
export async function tapRowStatus(
  houseKey: string,
  rowId: string,
  statusId: string,
): Promise<void> {
  buzz();
  const result = await run((db, context) => markRow(db, { ...context, rowId, statusId }));
  if (!result) return;
  apply(result);
  say(statusToast(result, houseKey), result.event.id);
  if (statuses.value.find((status) => status.id === statusId)?.asksForNote)
    sheet.value = { kind: 'note', houseKey, rowId };
}

/** Mark house as to visit: every row back to the start status; Visit date keeps the last visit. */
export async function reopenHouse(houseKey: string): Promise<void> {
  await tapHouseStatus(houseKey, startStatus(statuses.value).id);
}

/**
 * Edit info or Edit this row, saved. With New owner: the owners replaced, and their rows whose
 * visit was the owner before's, which go back to the start status.
 */
export async function saveEdits(
  houseKey: string,
  target: 'house' | 'row',
  writes: readonly EditWrite[],
  owners: { newOwners: readonly NewOwner[]; startOver: readonly string[] } = {
    newOwners: [],
    startOver: [],
  },
): Promise<boolean> {
  const { newOwners } = owners;
  const start = startStatus(statuses.value);
  const startOver = {
    statusId: start.id,
    packageStatusText: start.packageStatusText,
    rowIds: owners.startOver,
  };
  const result = await run((db, context) =>
    editFields(db, { ...context, houseKey, target, writes, newOwners, startOver }),
  );
  if (result === null) return false;
  apply(result);
  const named = newOwners.map((owner) => owner.next).filter(Boolean);
  say(
    newOwners.length > 0
      ? strings.toast.newOwner(named.join(', '))
      : strings.toast.infoUpdated(new Set(result.rows.map((row) => row.rowId)).size),
    result.event.id,
  );
  return true;
}

/** Use my location for this house. */
export async function pinHouseHere(
  houseKey: string,
  position: LatLng,
  accuracyM: number,
): Promise<void> {
  const result = await run((db, context) =>
    moveHouse(db, { ...context, houseKey, position, accuracyM }),
  );
  if (!result) return;
  apply(result);
  say(strings.toast.moved, result.event.id);
}

export async function refreshPending(): Promise<void> {
  const db = database();
  const loaded = current.value;
  pending.value = db && loaded ? await pendingCalls(db, loaded.campaign.id) : [];
}

/** The newest call dialed less than 30 minutes ago that still waits for its outcome. */
export function freshPendingCall(now = Date.now()): PendingCall | null {
  const fresh = pending.value.filter(
    (call) => now - Date.parse(call.startedAt) < PENDING_CALL_MINUTES * 60_000,
  );
  return fresh.at(-1) ?? null;
}

/** Tapping a number: stored before the dialer opens. */
export async function dial(houseKey: string, number: HouseNumber): Promise<void> {
  const call = await run((db, context) =>
    startCall(db, {
      id: ulid(),
      campaignId: context.campaignId,
      houseKey,
      number: number.display,
      startedAt: context.now,
    }),
  );
  if (!call) return;
  await refreshPending();
  openDialer(number.digits);
}

/** The outcome of a dialed call: Call date is when it started. */
export async function answerCall(pendingId: string, outcome: string): Promise<void> {
  const result = await run((db, context) => resolveCall(db, { ...context, pendingId, outcome }));
  await refreshPending();
  if (!result) return;
  apply(result);
  say(strings.toast.callLogged(outcome), result.event.id);
}

export async function dropCall(pendingId: string): Promise<void> {
  const db = database();
  if (!db) return;
  await discardCall(db, pendingId);
  await refreshPending();
}

/** Log call: a call made without Terrain's dialer; Call date is now. */
export async function logCallOutcome(
  houseKey: string,
  number: string | null,
  outcome: string,
): Promise<void> {
  const result = await run((db, context) =>
    logCall(db, {
      ...context,
      houseKey,
      number: number ?? '',
      outcome,
      callDate: context.now,
      scope: number === null ? 'house' : 'number',
    }),
  );
  if (!result) return;
  apply(result);
  say(strings.toast.callLogged(outcome), result.event.id);
}

/** A note for every row at the house, or for one row. */
export async function saveNote(
  houseKey: string,
  rowId: string | null,
  text: string,
): Promise<void> {
  const event = await run((db, context) => addNote(db, { ...context, houseKey, rowId, text }));
  if (!event) return;
  events.value = [...events.value, event];
  say(strings.toast.noteAdded, event.id);
}

export async function removeNote(noteEventId: string): Promise<void> {
  const event = await run((db, context) => deleteNote(db, { ...context, noteEventId }));
  if (!event) return;
  events.value = [...events.value, event];
  say(strings.toast.noteDeleted, event.id);
}

/** The toast's Undo. */
export async function undoLast(undoneEventId: string): Promise<void> {
  clearTimeout(toastTimer);
  toast.value = null;
  const result = await run((db, context) => undo(db, { ...context, undoneEventId }));
  if (result) apply(result);
}

import {
  applyToRows,
  revertRows,
  rowsChangedBy,
  type CallLoggedEvent,
  type FieldChange,
  type FieldsEditedEvent,
  type NoteAddedEvent,
  type NoteDeletedEvent,
  type TerrainEvent,
  type UndoEvent,
} from './events.ts';
import { currentValue, samePosition } from './identity.ts';
import type { Planned } from './lots.ts';
import type { LatLng, Row } from './types.ts';

/** What every action is told: its event's id, the campaign, the time and the house it was made at. */
export interface ActionContext {
  eventId: string;
  campaignId: string;
  now: string;
  houseKey: string;
}

/** One field of Edit info or Edit this row, and the rows it writes (from editLayout). */
export interface EditWrite {
  rowIds: readonly string[];
  column: string;
  value: string;
}

/**
 * Corrections saved together (§5.11): one event with every changed row and field, previous and new
 * values. A value equal to the imported one is no correction any more. Returns null when nothing changed.
 */
export function planEdit(
  context: ActionContext & {
    target: 'house' | 'row';
    rows: readonly Row[];
    writes: readonly EditWrite[];
  },
): Planned<FieldsEditedEvent> | null {
  const byId = new Map(context.rows.map((row) => [row.rowId, row]));
  const changes: FieldChange[] = [];
  const seen = new Set<string>();
  for (const write of context.writes) {
    for (const rowId of write.rowIds) {
      const row = byId.get(rowId);
      const key = `${rowId}\u0000${write.column}`;
      if (!row || seen.has(key)) continue;
      seen.add(key);
      const previous = currentValue(row, write.column);
      if (previous === write.value) continue;
      const imported = row.sourceFields[write.column] ?? '';
      changes.push({
        rowId,
        column: write.column,
        previous,
        next: write.value,
        previousEdit: row.edits[write.column] ?? null,
        nextEdit: write.value === imported ? null : write.value,
      });
    }
  }
  if (changes.length === 0) return null;
  const rowIds = [...new Set(changes.map((change) => change.rowId))];
  const event: FieldsEditedEvent = {
    id: context.eventId,
    campaignId: context.campaignId,
    type: 'fields_edited',
    at: context.now,
    rowIds,
    houseKey: context.houseKey,
    payload: { target: context.target, changes, location: null },
    exportedAt: null,
  };
  const changed = context.rows.filter((row) => rowIds.includes(row.rowId));
  return { event, rows: applyToRows(changed, event) };
}

/** "Use my location for this house" (§5.11): every row at the house moves to the phone's position. */
export function planMove(
  context: ActionContext & {
    rows: readonly Row[];
    position: LatLng;
    accuracyM: number | null;
  },
): Planned<FieldsEditedEvent> | null {
  const { rows, position } = context;
  if (rows.length === 0 || rows.every((row) => samePosition(row.position, position))) return null;
  const rowIds = rows.map((row) => row.rowId);
  const event: FieldsEditedEvent = {
    id: context.eventId,
    campaignId: context.campaignId,
    type: 'fields_edited',
    at: context.now,
    rowIds,
    houseKey: context.houseKey,
    payload: {
      target: 'house',
      changes: [],
      location: {
        rowIds,
        previous: Object.fromEntries(
          rows.map((row) => [row.rowId, { position: row.position, moved: row.touched.moved }]),
        ),
        next: { lat: position.lat, lng: position.lng },
        accuracyM: context.accuracyM,
      },
    },
    exportedAt: null,
  };
  return { event, rows: applyToRows(rows, event) };
}

/** A call outcome (§5.5): Call date and call result on the rows given, nothing else. */
export function planCall(
  context: ActionContext & {
    rows: readonly Row[];
    number: string;
    outcome: string;
    callDate: string;
    scope: 'number' | 'house';
  },
): Planned<CallLoggedEvent> {
  const { rows } = context;
  const event: CallLoggedEvent = {
    id: context.eventId,
    campaignId: context.campaignId,
    type: 'call_logged',
    at: context.now,
    rowIds: rows.map((row) => row.rowId),
    houseKey: context.houseKey,
    payload: {
      number: context.number,
      outcome: context.outcome,
      callDate: context.callDate,
      scope: context.scope,
      previous: Object.fromEntries(
        rows.map((row) => [
          row.rowId,
          { callDate: row.callDate, callResult: row.callResult, touched: row.touched },
        ]),
      ),
    },
    exportedAt: null,
  };
  return { event, rows: applyToRows(rows, event) };
}

/** A note for every row at the house, or for one row (§5.6). An empty note is no note. */
export function planNote(
  context: ActionContext & {
    rowIds: readonly string[];
    target: 'house' | 'row';
    text: string;
  },
): NoteAddedEvent | null {
  const text = context.text.trim();
  if (!text || context.rowIds.length === 0) return null;
  return {
    id: context.eventId,
    campaignId: context.campaignId,
    type: 'note_added',
    at: context.now,
    rowIds: [...context.rowIds],
    houseKey: context.houseKey,
    payload: { text, target: context.target },
    exportedAt: null,
  };
}

/** Deleting a note records it; the note leaves every row it covered and stays in the log (§5.6). */
export function planNoteDeletion(
  context: Omit<ActionContext, 'houseKey'> & { note: NoteAddedEvent },
): NoteDeletedEvent {
  return {
    id: context.eventId,
    campaignId: context.campaignId,
    type: 'note_deleted',
    at: context.now,
    rowIds: [...context.note.rowIds],
    houseKey: context.note.houseKey,
    payload: { noteEventId: context.note.id },
    exportedAt: null,
  };
}

/** Undo (§5.4): a compensating event, and the rows the undone event changed put back exactly. */
export function planUndo(
  context: Omit<ActionContext, 'houseKey'> & {
    undone: TerrainEvent;
    /** The rows the undone event touched, as they are now. */
    rows: readonly Row[];
  },
): Planned<UndoEvent> {
  const { undone } = context;
  const changed = new Set(rowsChangedBy(undone));
  const event: UndoEvent = {
    id: context.eventId,
    campaignId: context.campaignId,
    type: 'undo',
    at: context.now,
    rowIds: [...undone.rowIds],
    houseKey: undone.houseKey,
    payload: { undoneEventId: undone.id },
    exportedAt: null,
  };
  const rows = context.rows.filter((row) => changed.has(row.rowId));
  return { event, rows: revertRows(rows, undone, context.now) };
}

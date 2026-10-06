import type { ImportChange } from './merge.ts';
import { appValue } from './rows.ts';
import type { AppField, ColumnRoles, LatLng, LocalTouches, Row } from './types.ts';

/**
 * The event log. Every action appends one event holding what it changed and every
 * previous value. Rows store the result; `foldStates` replays the events over the imported values,
 * and tests check that both always agree.
 */
interface EventOf<Type extends string, Payload> {
  id: string;
  campaignId: string;
  type: Type;
  /** ISO 8601 with the device's UTC offset. */
  at: string;
  /** Every row the event touches. */
  rowIds: string[];
  /** The house it was made at, for display; null for imports. */
  houseKey: string | null;
  payload: Payload;
  exportedAt: string | null;
}

/**
 * A new owner named by the client's file (Alex, 2026-10-06): the row started over at the file's
 * status, the old owner's corrections went, and the owner before went to Previous info.
 */
export interface ImportedOwner {
  rowId: string;
  previous: string;
  next: string;
  /** The Previous info column, and its correction before and after. */
  column: string;
  previousEdit: string | null;
  nextEdit: string;
  /** Columns whose correction was the old owner's, dropped. */
  dropped: string[];
  previousStatusId: string;
  nextStatusId: string;
}

/** A file imported into a campaign. Its changes hold every previous value (Journal: Import update). */
export type ImportEvent = EventOf<
  'import',
  {
    fileName: string;
    added: string[];
    ownerDetailsChanged: string[];
    missing: string[];
    changes: ImportChange[];
    /** Corrections the file now agrees with: they stopped being corrections. */
    absorbed: { rowId: string; column: string }[];
    /** Absent before 2026-10-06. */
    newOwners?: ImportedOwner[];
  }
>;

/** What local events change on a row: app fields, corrections, position and where its status came from. */
export interface RowState {
  statusId: string;
  packageStatusText: string;
  visitDate: string;
  callDate: string;
  callResult: string;
  edits: Record<string, string>;
  position: LatLng | null;
  origin: Row['origin'];
  touched: LocalTouches;
}

export type StatusFields = Pick<
  RowState,
  'statusId' | 'packageStatusText' | 'visitDate' | 'origin' | 'touched'
>;

/** Who and where a tap reached the rest of its lots from, fixed at the moment of the tap. */
export interface LotMark {
  /** 'spread': replaceable rows elsewhere took the status (Given); 'note': rows elsewhere only get a note (To research). */
  mode: 'spread' | 'note';
  /** The status label at the tap. */
  statusLabel: string;
  /** The owners at the house, in file order; empty when no row names anyone. */
  names: string[];
  /** The house's ADRESSE; blank for a pin with no address. */
  address: string;
  /** The house's parcel ID, naming a pin with no address. */
  parcelId: string;
}

export type StatusSetEvent = EventOf<
  'status_set',
  {
    statusId: string;
    /** Written into Package status: the status's text at the tap. */
    packageStatusText: string;
    /** The house rail, or one row's own rail ("This row only"). */
    target: 'house' | 'row';
    /** The rows marked directly. */
    targetRowIds: string[];
    /** Target rows the tap wrote: all of them, or on a repeat tap only those closed from the lot. */
    writtenRowIds: string[];
    /** False for Mark as to visit: Visit date keeps the last visit. */
    stampsVisitDate: boolean;
    lot: LotMark | null;
    /** Rows of the same lots at other houses. Each gets the lot note; replaceable ones change status. */
    lotAffected: { rowId: string; statusChanged: boolean }[];
    /** Whether rows closed from the lot got Visit date (Settings → Lots). */
    lotVisitDate: boolean;
    /** Each changed row before the tap. */
    previous: Record<string, StatusFields>;
  }
>;

export interface FieldChange {
  rowId: string;
  column: string;
  /** Current values before and after, for the Journal. */
  previous: string;
  next: string;
  /** The stored correction before and after; null means none, so the imported value shows. */
  previousEdit: string | null;
  nextEdit: string | null;
}

export interface LocationChange {
  rowIds: string[];
  previous: Record<string, { position: LatLng | null; moved: boolean }>;
  next: LatLng;
  accuracyM: number | null;
}

/** New owner in Edit info: whose rows, and the owner's name before and after. */
export interface NewOwner {
  rowIds: string[];
  previous: string;
  next: string;
}

export type FieldsEditedEvent = EventOf<
  'fields_edited',
  {
    /** Edit info (the house) or Edit this row. */
    target: 'house' | 'row';
    changes: FieldChange[];
    /** "Use my location for this house". */
    location: LocationChange | null;
    /** Owners replaced by a new one; their changes are among the others. Absent before 2026-10-06. */
    newOwners?: NewOwner[];
    /**
     * Rows of a new owner whose visit was the owner before's, back to the start status with no
     * Visit date, each as it was before (Alex, 2026-10-06: a visit made while the owner changes is
     * the new owner's; an older one goes to Previous info).
     */
    startOver?: {
      statusId: string;
      packageStatusText: string;
      previous: Record<string, StatusFields>;
    };
  }
>;

export type CallFields = Pick<RowState, 'callDate' | 'callResult' | 'touched'>;

export type CallLoggedEvent = EventOf<
  'call_logged',
  {
    number: string;
    outcome: string;
    /** When the call started. */
    callDate: string;
    /** 'number': the rows listing the number; 'house': a number not on file, logged on the whole house. */
    scope: 'number' | 'house';
    previous: Record<string, CallFields>;
  }
>;

export type NoteAddedEvent = EventOf<'note_added', { text: string; target: 'house' | 'row' }>;

export type NoteDeletedEvent = EventOf<'note_deleted', { noteEventId: string }>;

/** A compensating event: the undone event stays in the log. */
export type UndoEvent = EventOf<'undo', { undoneEventId: string }>;

export type TerrainEvent =
  | ImportEvent
  | StatusSetEvent
  | FieldsEditedEvent
  | CallLoggedEvent
  | NoteAddedEvent
  | NoteDeletedEvent
  | UndoEvent;

export function stateOf(row: RowState): RowState {
  return {
    statusId: row.statusId,
    packageStatusText: row.packageStatusText,
    visitDate: row.visitDate,
    callDate: row.callDate,
    callResult: row.callResult,
    edits: row.edits,
    position: row.position,
    origin: row.origin,
    touched: row.touched,
  };
}

export function withTouched(touched: LocalTouches, fields: readonly AppField[]): LocalTouches {
  return {
    appFields: [...new Set([...touched.appFields, ...fields])].sort(),
    moved: touched.moved,
  };
}

function withEdit(
  edits: Record<string, string>,
  column: string,
  value: string | null,
): Record<string, string> {
  const next = Object.fromEntries(Object.entries(edits).filter(([key]) => key !== column));
  if (value !== null) next[column] = value;
  return next;
}

function update(
  states: Map<string, RowState>,
  rowId: string,
  change: (state: RowState) => RowState,
): void {
  const state = states.get(rowId);
  if (state) states.set(rowId, change(state));
}

const STAMPED: readonly AppField[] = ['status', 'packageStatus', 'visitDate'];
const UNSTAMPED: readonly AppField[] = ['status', 'packageStatus'];

/**
 * What an event did, applied to the states of the rows it touched. Replay and actions both use it.
 * A replay passes each row's baseline: a new owner a file brought starts over from the latest
 * import's values, and the events after it apply on top.
 */
export function applyEvent(
  states: Map<string, RowState>,
  event: TerrainEvent,
  baselines?: ReadonlyMap<string, RowState>,
): void {
  switch (event.type) {
    case 'import':
      for (const { rowId, column } of event.payload.absorbed) {
        update(states, rowId, (state) => ({
          ...state,
          edits: withEdit(state.edits, column, null),
        }));
      }
      for (const owner of event.payload.newOwners ?? []) {
        const base = baselines?.get(owner.rowId);
        update(states, owner.rowId, (state) => ({
          ...state,
          ...(base && {
            statusId: base.statusId,
            packageStatusText: base.packageStatusText,
            visitDate: base.visitDate,
            callDate: base.callDate,
            callResult: base.callResult,
          }),
          origin: null,
          touched: { appFields: [], moved: state.touched.moved },
          edits: withEdit(
            Object.fromEntries(
              Object.entries(state.edits).filter(([column]) => !owner.dropped.includes(column)),
            ),
            owner.column,
            owner.nextEdit,
          ),
        }));
      }
      return;
    case 'status_set': {
      const tap = event.payload;
      for (const rowId of tap.writtenRowIds) {
        update(states, rowId, (state) => ({
          ...state,
          statusId: tap.statusId,
          packageStatusText: tap.packageStatusText,
          visitDate: tap.stampsVisitDate ? event.at : state.visitDate,
          origin: null,
          touched: withTouched(state.touched, tap.stampsVisitDate ? STAMPED : UNSTAMPED),
        }));
      }
      for (const { rowId, statusChanged } of tap.lotAffected) {
        if (!statusChanged) continue;
        update(states, rowId, (state) => ({
          ...state,
          statusId: tap.statusId,
          packageStatusText: tap.packageStatusText,
          visitDate: tap.lotVisitDate ? event.at : state.visitDate,
          origin: { eventId: event.id, fromHouseKey: event.houseKey ?? '' },
          touched: withTouched(state.touched, tap.lotVisitDate ? STAMPED : UNSTAMPED),
        }));
      }
      return;
    }
    case 'fields_edited': {
      for (const change of event.payload.changes) {
        update(states, change.rowId, (state) => ({
          ...state,
          edits: withEdit(state.edits, change.column, change.nextEdit),
        }));
      }
      const location = event.payload.location;
      if (location) {
        for (const rowId of location.rowIds) {
          update(states, rowId, (state) => ({
            ...state,
            position: location.next,
            touched: { ...state.touched, moved: true },
          }));
        }
      }
      const startOver = event.payload.startOver;
      if (startOver) {
        for (const rowId of Object.keys(startOver.previous)) {
          update(states, rowId, (state) => ({
            ...state,
            statusId: startOver.statusId,
            packageStatusText: startOver.packageStatusText,
            visitDate: '',
            origin: null,
            touched: withTouched(state.touched, STAMPED),
          }));
        }
      }
      return;
    }
    case 'call_logged': {
      const call = event.payload;
      for (const rowId of event.rowIds) {
        update(states, rowId, (state) => ({
          ...state,
          callDate: call.callDate,
          callResult: call.outcome,
          touched: withTouched(state.touched, ['callDate', 'callResult']),
        }));
      }
      return;
    }
    case 'note_added':
    case 'note_deleted':
    case 'undo':
      return;
  }
}

/** Puts back what an event changed, from the previous values it recorded (Undo). */
export function revertEvent(states: Map<string, RowState>, event: TerrainEvent): void {
  switch (event.type) {
    case 'status_set':
      for (const [rowId, previous] of Object.entries(event.payload.previous)) {
        update(states, rowId, (state) => ({ ...state, ...previous }));
      }
      return;
    case 'fields_edited': {
      for (const [rowId, previous] of Object.entries(event.payload.startOver?.previous ?? {})) {
        update(states, rowId, (state) => ({ ...state, ...previous }));
      }
      for (const change of [...event.payload.changes].reverse()) {
        update(states, change.rowId, (state) => ({
          ...state,
          edits: withEdit(state.edits, change.column, change.previousEdit),
        }));
      }
      const location = event.payload.location;
      if (location) {
        for (const [rowId, previous] of Object.entries(location.previous)) {
          update(states, rowId, (state) => ({
            ...state,
            position: previous.position,
            touched: { ...state.touched, moved: previous.moved },
          }));
        }
      }
      return;
    }
    case 'call_logged':
      for (const [rowId, previous] of Object.entries(event.payload.previous)) {
        update(states, rowId, (state) => ({ ...state, ...previous }));
      }
      return;
    case 'note_added':
    case 'note_deleted':
      return;
    case 'import':
    case 'undo':
      throw new Error(`A ${event.type} event can't be undone.`);
  }
}

/** The rows whose stored values an event changed (notes change none). */
export function rowsChangedBy(event: TerrainEvent): string[] {
  switch (event.type) {
    case 'status_set':
    case 'call_logged':
      return Object.keys(event.payload.previous);
    case 'fields_edited':
      return [
        ...new Set([
          ...event.payload.changes.map((change) => change.rowId),
          ...(event.payload.location?.rowIds ?? []),
          ...Object.keys(event.payload.startOver?.previous ?? {}),
        ]),
      ];
    case 'import':
      return event.rowIds;
    case 'note_added':
    case 'note_deleted':
    case 'undo':
      return [];
  }
}

/** The rows an event changed, with their new state. */
export function applyToRows(rows: readonly Row[], event: TerrainEvent): Row[] {
  const states = new Map(rows.map((row) => [row.rowId, stateOf(row)]));
  applyEvent(states, event);
  return rows.map((row) => ({ ...row, ...states.get(row.rowId), updatedAt: event.at }));
}

/** The rows an event changed, put back as they were before it. */
export function revertRows(rows: readonly Row[], event: TerrainEvent, at: string): Row[] {
  const states = new Map(rows.map((row) => [row.rowId, stateOf(row)]));
  revertEvent(states, event);
  return rows.map((row) => ({ ...row, ...states.get(row.rowId), updatedAt: at }));
}

/** Ids of events an undo took back. */
export function undoneIds(events: readonly TerrainEvent[]): Set<string> {
  const undone = new Set<string>();
  for (const event of events) if (event.type === 'undo') undone.add(event.payload.undoneEventId);
  return undone;
}

/** The event the toast's Undo takes back: the last one, when it is an action. */
export function undoable(events: readonly TerrainEvent[]): TerrainEvent | null {
  const last = events.at(-1);
  return last && last.type !== 'import' && last.type !== 'undo' ? last : null;
}

/** A row as its latest import left it, before any local event. */
export function baselineState(row: Row, roles: ColumnRoles): RowState {
  return {
    statusId: row.importedStatusId,
    packageStatusText: appValue(row.sourceFields, roles, 'packageStatus'),
    visitDate: appValue(row.sourceFields, roles, 'visitDate'),
    callDate: appValue(row.sourceFields, roles, 'callDate'),
    callResult: appValue(row.sourceFields, roles, 'callResult'),
    edits: {},
    position: row.importedPosition,
    origin: null,
    touched: { appFields: [], moved: false },
  };
}

/** Every row replayed from its imported values through the campaign's events, in order, undone ones skipped. */
export function foldStates(
  rows: readonly Row[],
  events: readonly TerrainEvent[],
  roles: ColumnRoles,
): Map<string, RowState> {
  const baselines = new Map(rows.map((row) => [row.rowId, baselineState(row, roles)]));
  const states = new Map(baselines);
  const undone = undoneIds(events);
  for (const event of events) {
    if (event.type !== 'undo' && !undone.has(event.id)) applyEvent(states, event, baselines);
  }
  return states;
}

import { undoneIds, type TerrainEvent } from '../events.ts';
import { formatTime, type DateFormat } from '../format.ts';
import { currentReader, currentValue, displayName } from '../identity.ts';
import { formatPosition } from '../merge.ts';
import { lotNoteText, type NoteWords } from '../notes.ts';
import type { Campaign, Row, Status } from '../types.ts';
import { inFileOrder } from './sheet.ts';

/** The Journal's actions. */
export type JournalAction =
  | 'status'
  | 'statusViaLot'
  | 'lotNote'
  | 'fieldEdited'
  | 'newOwner'
  | 'pinMoved'
  | 'importUpdate'
  | 'call'
  | 'note'
  | 'noteDeleted'
  | 'undo';

/** The Journal's words, from src/ui/strings.ts. */
export interface JournalWords {
  /** Date, Time, Parcel ID, Owner, Address, Action, Detail, Previous value, New value. */
  headers: readonly string[];
  actions: Readonly<Record<JournalAction, string>>;
  /** Detail of a call logged on the whole house, to a number that isn't on file. */
  otherNumber: string;
  /** Detail of Pin moved: how precise the phone's position was. */
  accuracy: (meters: number) => string;
  /** Detail of an Undo line: what it took back. */
  undid: (action: string, detail: string) => string;
}

/** One row affected by one action. */
export interface JournalLine {
  eventId: string;
  at: string;
  rowId: string;
  action: JournalAction;
  detail: string;
  previous: string;
  next: string;
}

export interface JournalInput {
  campaign: Pick<Campaign, 'roles'>;
  rows: readonly Row[];
  events: readonly TerrainEvent[];
  statuses: readonly Status[];
  noteWords: NoteWords;
  words: JournalWords;
  format: DateFormat;
}

/**
 * The Journal: one line per row affected by each event, in the order they happened, rows in
 * file order. It is the permanent record: undone actions stay, followed by their Undo lines, and
 * every value something replaced is in its Previous value.
 */
export function journalLines(input: JournalInput): JournalLine[] {
  const { events, statuses, noteWords, words, format } = input;
  const order = new Map(inFileOrder(input.rows).map((row, i) => [row.rowId, i]));
  const inOrder = (rowIds: Iterable<string>) =>
    [...new Set(rowIds)]
      .filter((rowId) => order.has(rowId))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const byId = new Map(events.map((event) => [event.id, event]));
  const label = (statusId: string) =>
    statuses.find((status) => status.id === statusId)?.label ?? statusId;

  const linesOf = (event: TerrainEvent): JournalLine[] => {
    const line = (
      rowId: string,
      action: JournalAction,
      detail: string,
      previous: string,
      next: string,
    ): JournalLine => ({ eventId: event.id, at: event.at, rowId, action, detail, previous, next });

    switch (event.type) {
      case 'import': {
        const changes = [...event.payload.changes].sort(
          (a, b) => (order.get(a.rowId) ?? 0) - (order.get(b.rowId) ?? 0),
        );
        return changes
          .filter((change) => order.has(change.rowId))
          .map((change) =>
            line(change.rowId, 'importUpdate', change.column, change.previous, change.next),
          );
      }
      case 'status_set': {
        const tap = event.payload;
        const before = (rowId: string) => tap.previous[rowId]?.packageStatusText ?? '';
        const lines = inOrder(tap.writtenRowIds).map((rowId) =>
          line(rowId, 'status', label(tap.statusId), before(rowId), tap.packageStatusText),
        );
        if (tap.lot) {
          const note = lotNoteText(tap.lot, event.at, noteWords, format);
          const closed = new Set(
            tap.lotAffected.filter((affected) => affected.statusChanged).map((a) => a.rowId),
          );
          for (const rowId of inOrder(tap.lotAffected.map((affected) => affected.rowId))) {
            lines.push(
              closed.has(rowId)
                ? line(rowId, 'statusViaLot', note, before(rowId), tap.packageStatusText)
                : line(rowId, 'lotNote', '', '', note),
            );
          }
        }
        return lines;
      }
      case 'fields_edited': {
        const changes = [...event.payload.changes].sort(
          (a, b) => (order.get(a.rowId) ?? 0) - (order.get(b.rowId) ?? 0),
        );
        const replaced = new Set((event.payload.newOwners ?? []).flatMap((owner) => owner.rowIds));
        const lines = changes
          .filter((change) => order.has(change.rowId))
          .map((change) =>
            line(
              change.rowId,
              replaced.has(change.rowId) ? 'newOwner' : 'fieldEdited',
              change.column,
              change.previous,
              change.next,
            ),
          );
        const location = event.payload.location;
        if (location) {
          const detail = location.accuracyM === null ? '' : words.accuracy(location.accuracyM);
          for (const rowId of inOrder(location.rowIds)) {
            lines.push(
              line(
                rowId,
                'pinMoved',
                detail,
                formatPosition(location.previous[rowId]?.position ?? null),
                formatPosition(location.next),
              ),
            );
          }
        }
        return lines;
      }
      case 'call_logged': {
        const call = event.payload;
        return inOrder(event.rowIds).map((rowId) =>
          line(
            rowId,
            'call',
            call.number || words.otherNumber,
            call.previous[rowId]?.callResult ?? '',
            call.outcome,
          ),
        );
      }
      case 'note_added':
        return inOrder(event.rowIds).map((rowId) =>
          line(rowId, 'note', '', '', event.payload.text),
        );
      case 'note_deleted': {
        const added = byId.get(event.payload.noteEventId);
        if (added?.type !== 'note_added') return [];
        return inOrder(added.rowIds).map((rowId) =>
          line(rowId, 'noteDeleted', '', added.payload.text, ''),
        );
      }
      case 'undo': {
        const undone = byId.get(event.payload.undoneEventId);
        if (!undone) return [];
        return linesOf(undone).map((taken) => ({
          ...taken,
          eventId: event.id,
          at: event.at,
          action: 'undo',
          detail: words.undid(words.actions[taken.action], taken.detail),
          previous: taken.next,
          next: taken.previous,
        }));
      }
    }
  };
  return events.flatMap(linesOf);
}

/**
 * The Journal sheet: Date and Time in the date format, the row's current parcel ID and address,
 * and its owner: the current one, or before a New owner, the one replaced (Alex, 2026-10-06).
 */
export function journalSheet(input: JournalInput): string[][] {
  const { campaign, words, format } = input;
  const byId = new Map(input.rows.map((row) => [row.rowId, row]));
  const [datePart = format] = format.split(' ');
  const undone = undoneIds(input.events);
  const position = new Map(input.events.map((event, i) => [event.id, i]));
  const handovers = new Map<string, { index: number; previous: string }[]>();
  input.events.forEach((event, index) => {
    if (event.type !== 'fields_edited' || undone.has(event.id)) return;
    for (const owner of event.payload.newOwners ?? [])
      for (const rowId of owner.rowIds)
        handovers.set(rowId, [
          ...(handovers.get(rowId) ?? []),
          { index, previous: owner.previous },
        ]);
  });
  const lines = journalLines(input).map((line) => {
    const row = byId.get(line.rowId);
    const reader = row ? currentReader(row, campaign.roles) : () => '';
    const street = row ? currentValue(row, campaign.roles.street) : '';
    const index = position.get(line.eventId) ?? Infinity;
    const later = handovers.get(line.rowId)?.find((handover) => handover.index > index);
    return [
      formatTime(line.at, datePart),
      formatTime(line.at, 'HH:mm'),
      row?.parcelIdRaw ?? '',
      later ? later.previous : displayName(reader),
      street.split(/\r?\n/)[0]?.trim() ?? '',
      words.actions[line.action],
      line.detail,
      line.previous,
      line.next,
    ];
  });
  return [[...words.headers], ...lines];
}

import { undoneIds, type LotMark, type TerrainEvent } from './events.ts';
import { DATE_FORMATS, formatTime, type DateFormat } from './format.ts';
import type { Row } from './types.ts';

/** Settings → Notes in export (§5.9): every note oldest first, each after its date, or the latest only. */
export type NotesExportMode = 'joined' | 'latest';

/** The wording of notes, from src/ui/strings.ts: the domain holds no sentences. */
export interface NoteWords {
  /** "Given with Alain Trempette / Marie Trempette at 123 rue Saint-Paul, 26.09.2026 14:32" */
  lotSpread: (status: string, who: string, address: string, when: string) => string;
  /** "Co-owner to research: Luc Trempette at 12 chemin du Lac, 26.09.2026 14:32" */
  lotNote: (status: string, who: string, address: string, when: string) => string;
  /** Who, when no row at the house names anyone. */
  someone: string;
  /** Where, for a house with no address. */
  pinWithoutAddress: (parcelId: string) => string;
  /** A house or row note in an export, after its date. */
  dated: (when: string, text: string) => string;
}

export interface Note {
  /** The event that wrote it; null for the imported Notes cell. */
  eventId: string | null;
  kind: 'imported' | 'house' | 'row' | 'lot';
  /** When it was written; null for the imported Notes cell. */
  at: string | null;
  text: string;
  /** The rows it covers. */
  rowIds: string[];
}

/** A lot note, rendered from the tap that made it: names and address as they were at the tap (§5.10). */
export function lotNoteText(
  mark: LotMark,
  at: string,
  words: NoteWords,
  format: DateFormat,
): string {
  const who = mark.names.length > 0 ? mark.names.join(' / ') : words.someone;
  const where = mark.address || words.pinWithoutAddress(mark.parcelId);
  const when = formatTime(at, format);
  return mark.mode === 'spread'
    ? words.lotSpread(mark.statusLabel, who, where, when)
    : words.lotNote(mark.statusLabel, who, where, when);
}

/**
 * Every row's notes, newest first (§5.6): house and row notes, lot notes rendered from status taps,
 * and last the imported Notes cell. Undone and deleted notes are left out.
 */
export function notesByRow(
  rows: readonly Pick<Row, 'rowId' | 'importedNotes'>[],
  events: readonly TerrainEvent[],
  words: NoteWords,
  format: DateFormat,
): Map<string, Note[]> {
  const undone = undoneIds(events);
  const deleted = new Set<string>();
  for (const event of events) {
    if (event.type === 'note_deleted' && !undone.has(event.id))
      deleted.add(event.payload.noteEventId);
  }
  const byRow = new Map<string, Note[]>(rows.map((row) => [row.rowId, []]));
  const add = (note: Note) => {
    for (const rowId of note.rowIds) byRow.get(rowId)?.push(note);
  };
  for (const event of events) {
    if (undone.has(event.id)) continue;
    if (event.type === 'note_added' && !deleted.has(event.id)) {
      add({
        eventId: event.id,
        kind: event.payload.target,
        at: event.at,
        text: event.payload.text,
        rowIds: event.rowIds,
      });
    } else if (event.type === 'status_set' && event.payload.lot) {
      add({
        eventId: event.id,
        kind: 'lot',
        at: event.at,
        text: lotNoteText(event.payload.lot, event.at, words, format),
        rowIds: event.payload.lotAffected.map((affected) => affected.rowId),
      });
    }
  }
  for (const row of rows) {
    const notes = (byRow.get(row.rowId) ?? []).reverse();
    if (row.importedNotes.trim()) {
      notes.push({
        eventId: null,
        kind: 'imported',
        at: null,
        text: row.importedNotes,
        rowIds: [row.rowId],
      });
    }
    byRow.set(row.rowId, notes);
  }
  return byRow;
}

/**
 * The Notes cell of a row in an export (§5.8, §5.9), from its notes newest first. House and row
 * notes get their date in front; lot notes already end with theirs, and the imported cell has none.
 */
export function notesCell(
  notes: readonly Note[],
  mode: NotesExportMode,
  words: NoteWords,
  format: DateFormat,
): string {
  const chosen = mode === 'latest' ? notes.slice(0, 1) : [...notes].reverse();
  return chosen
    .map((note) =>
      (note.kind === 'house' || note.kind === 'row') && note.at
        ? words.dated(formatTime(note.at, format), note.text)
        : note.text,
    )
    .join('\n');
}

/**
 * Every way Terrain may have written a row's notes into an export's Notes cell: each house, row and
 * lot note it ever held, in every date format. Deleted and undone notes count too: an earlier
 * export may carry them.
 */
export function ownNoteTexts(
  events: readonly TerrainEvent[],
  words: NoteWords,
): Map<string, string[]> {
  const byRow = new Map<string, Set<string>>();
  const add = (rowIds: readonly string[], texts: readonly string[]) => {
    for (const rowId of rowIds) {
      const known = byRow.get(rowId) ?? new Set<string>();
      for (const text of texts) known.add(text);
      byRow.set(rowId, known);
    }
  };
  for (const event of events) {
    if (event.type === 'note_added') {
      const { text } = event.payload;
      add(
        event.rowIds,
        DATE_FORMATS.map((format) => words.dated(formatTime(event.at, format), text)),
      );
    } else if (event.type === 'status_set' && event.payload.lot) {
      const mark = event.payload.lot;
      add(
        event.payload.lotAffected.map((affected) => affected.rowId),
        DATE_FORMATS.map((format) => lotNoteText(mark, event.at, words, format)),
      );
    }
  }
  return new Map([...byRow].map(([rowId, texts]) => [rowId, [...texts]]));
}

/**
 * A Notes cell from a file, without the notes Terrain wrote into it: an export coming back (the
 * client's Excel, or My Maps after Replace all items) shows each note once (§6.4). Whatever else
 * the cell holds is the client's and stays.
 */
export function withoutOwnNotes(cell: string, own: readonly string[]): string {
  if (own.length === 0 || cell.trim() === '') return cell;
  const longestFirst = [...own].sort((a, b) => b.length - a.length);
  let removed = false;
  let lines = cell.split(/\r?\n/);
  for (const text of longestFirst) {
    const block = text.split(/\r?\n/).map((line) => line.trim());
    for (let i = 0; i + block.length <= lines.length;) {
      if (block.every((line, k) => lines[i + k]?.trim() === line)) {
        lines = [...lines.slice(0, i), ...lines.slice(i + block.length)];
        removed = true;
      } else i += 1;
    }
  }
  // A cell that lost its line breaks on the way still holds the notes, one after the other.
  let rest = lines.join('\n');
  for (const text of longestFirst) {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat !== '' && rest.includes(flat)) {
      rest = rest
        .split(flat)
        .map((part) => part.trim())
        .filter(Boolean)
        .join('\n');
      removed = true;
    }
  }
  return removed ? rest.trim() : cell;
}

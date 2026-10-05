import { undoneIds, type TerrainEvent } from './events.ts';
import { fileDate, formatTime } from './format.ts';
import { currentReader, currentValue, displayName } from './identity.ts';
import type { Campaign, Row, Status } from './types.ts';

/** The day log's words, from src/ui/strings.ts. */
export interface DayLogWords {
  rows: (n: number) => string;
  /** "P1-216B (2 rows)", or "P1-217A" for one row. */
  parcelRows: (parcelId: string, rows: number) => string;
  /** "info updated: TEL_RES (Alain Trempette), CELLULAIRE (Marie Trempette)" */
  infoUpdated: (fields: string) => string;
  field: (column: string, whom: string) => string;
  /** "pinned where you were (8 m)" */
  moved: (accuracyM: number | null) => string;
  /** "call 514 555-0199: Voicemail" */
  call: (number: string, outcome: string) => string;
  otherNumber: string;
  note: (text: string) => string;
  noteDeleted: (text: string) => string;
  /** An action on some rows of the house only: "note: Rappeler (Marie Trempette)". */
  forWhom: (text: string, whom: string) => string;
  /** "also closed 12 chemin du Lac (Luc Trempette, P1-216B)" */
  alsoClosed: (address: string, rows: string) => string;
  alsoNoted: (address: string, rows: string) => string;
  ownerOnParcel: (name: string, parcelId: string) => string;
  someone: string;
  noAddress: string;
  /** The text to copy or share. */
  title: (campaign: string, day: string) => string;
  statusCount: (status: string, rows: number, viaLot: number) => string;
  corrections: (n: number) => string;
  calls: (n: number) => string;
  notes: (n: number) => string;
  nothing: string;
}

/** One action of the day, named by the house it was made at (§5.7). */
export interface DayLine {
  eventId: string;
  at: string;
  /** The house today, to show it on the map; null when its rows are gone. */
  houseKey: string | null;
  address: string;
  text: string;
  /** Lines under it: the parcels marked, the houses the lot reached. */
  details: string[];
}

export interface DayCount {
  statusId: string;
  label: string;
  color: string;
  /** Rows marked at their own house. */
  direct: number;
  /** Rows closed from their lot at another house. */
  viaLot: number;
}

export interface DayLog {
  day: string;
  counts: DayCount[];
  corrections: number;
  calls: number;
  notes: number;
  lines: DayLine[];
}

export interface DayLogInput {
  /** YYYY-MM-DD, the local date of the taps. */
  day: string;
  campaign: Pick<Campaign, 'roles'>;
  rows: readonly Row[];
  events: readonly TerrainEvent[];
  statuses: readonly Status[];
  words: DayLogWords;
}

/** What the day log lists: what Alex did, not imports; undone actions and the undos left out. */
function actions(events: readonly TerrainEvent[]): TerrainEvent[] {
  const undone = undoneIds(events);
  return events.filter(
    (event) => event.type !== 'import' && event.type !== 'undo' && !undone.has(event.id),
  );
}

/** The days with something in their log, oldest first. */
export function activeDays(events: readonly TerrainEvent[]): string[] {
  return [...new Set(actions(events).map((event) => fileDate(event.at)))].sort();
}

/** The day log of one day (§5.7): counts, then one line per action in the order they happened. */
export function dayLog(input: DayLogInput): DayLog {
  const { campaign, rows, events, statuses, words } = input;
  const byId = new Map(rows.map((row) => [row.rowId, row]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const houseRows = new Map<string, Row[]>();
  for (const row of [...rows].sort((a, b) => a.rowIndex - b.rowIndex)) {
    const list = houseRows.get(row.houseKey);
    if (list) list.push(row);
    else houseRows.set(row.houseKey, [row]);
  }
  const nameOf = (row: Row) => displayName(currentReader(row, campaign.roles)) || words.someone;
  const addressOf = (houseKey: string) => {
    for (const row of houseRows.get(houseKey) ?? []) {
      const street = currentValue(row, campaign.roles.street).split(/\r?\n/)[0]?.trim() ?? '';
      if (street) return street;
    }
    return words.noAddress;
  };
  const existing = (rowIds: readonly string[]) =>
    rowIds.flatMap((rowId) => {
      const row = byId.get(rowId);
      return row ? [row] : [];
    });
  /** Whose rows an action reached, unless it is every row of the house. */
  const whom = (reached: readonly Row[], houseKey: string): string | null => {
    const all = houseRows.get(houseKey) ?? [];
    if (reached.length === all.length) return null;
    return [...new Set(reached.map(nameOf))].join(' / ');
  };
  const parcelOf = (row: Row) => row.parcelIdRaw.split(/\r?\n/)[0]?.trim() ?? '';
  const byHouse = (reached: readonly Row[]) => {
    const groups = new Map<string, Row[]>();
    for (const row of reached) {
      const list = groups.get(row.houseKey);
      if (list) list.push(row);
      else groups.set(row.houseKey, [row]);
    }
    return [...groups];
  };
  const described = (reached: readonly Row[]) =>
    reached.map((row) => words.ownerOnParcel(nameOf(row), parcelOf(row))).join('; ');

  const counts = new Map<string, { direct: number; viaLot: number }>();
  let corrections = 0;
  let calls = 0;
  let notes = 0;
  const lines: DayLine[] = [];

  for (const event of actions(events)) {
    if (fileDate(event.at) !== input.day) continue;
    let reached: Row[] = [];
    let text = '';
    const details: string[] = [];
    switch (event.type) {
      case 'status_set': {
        const tap = event.payload;
        const status = statuses.find((candidate) => candidate.id === tap.statusId);
        const written = existing(tap.writtenRowIds);
        reached = written.length > 0 ? written : existing(tap.targetRowIds);
        const closed = existing(
          tap.lotAffected.filter((affected) => affected.statusChanged).map((a) => a.rowId),
        );
        const noted = existing(
          tap.lotAffected.filter((affected) => !affected.statusChanged).map((a) => a.rowId),
        );
        const count = counts.get(tap.statusId) ?? { direct: 0, viaLot: 0 };
        counts.set(tap.statusId, {
          direct: count.direct + written.length,
          viaLot: count.viaLot + closed.length,
        });
        const label = status?.label ?? tap.statusId;
        const house = reached[0]?.houseKey ?? '';
        const who = tap.target === 'row' ? whom(reached, house) : null;
        text = who ? words.forWhom(label, who) : label;
        if (tap.target === 'house' && written.length > 1) {
          const parcels = new Map<string, number>();
          for (const row of written)
            parcels.set(parcelOf(row), (parcels.get(parcelOf(row)) ?? 0) + 1);
          details.push([...parcels].map(([parcel, n]) => words.parcelRows(parcel, n)).join(', '));
        }
        for (const [houseKey, list] of byHouse(closed))
          details.push(words.alsoClosed(addressOf(houseKey), described(list)));
        for (const [houseKey, list] of byHouse(noted))
          details.push(words.alsoNoted(addressOf(houseKey), described(list)));
        break;
      }
      case 'fields_edited': {
        const { changes, location } = event.payload;
        reached = existing([
          ...new Set([...changes.map((change) => change.rowId), ...(location?.rowIds ?? [])]),
        ]);
        const house = reached[0]?.houseKey ?? '';
        const parts: string[] = [];
        if (changes.length > 0) {
          const columns = new Map<string, string[]>();
          for (const change of changes)
            columns.set(change.column, [...(columns.get(change.column) ?? []), change.rowId]);
          const fields = [...columns].map(([column, rowIds]) => {
            const covered = existing(rowIds);
            const all = houseRows.get(house) ?? [];
            return words.field(
              column,
              covered.length === all.length && all.length > 1
                ? words.rows(covered.length)
                : [...new Set(covered.map(nameOf))].join(' / '),
            );
          });
          parts.push(words.infoUpdated(fields.join(', ')));
          corrections += changes.length;
        }
        if (location) {
          parts.push(words.moved(location.accuracyM));
          corrections += 1;
        }
        text = parts.join('; ');
        break;
      }
      case 'call_logged': {
        reached = existing(event.rowIds);
        const call = words.call(event.payload.number || words.otherNumber, event.payload.outcome);
        const who = whom(reached, reached[0]?.houseKey ?? '');
        text = who ? words.forWhom(call, who) : call;
        calls += 1;
        break;
      }
      case 'note_added': {
        reached = existing(event.rowIds);
        const note = words.note(event.payload.text);
        const who =
          event.payload.target === 'row' ? whom(reached, reached[0]?.houseKey ?? '') : null;
        text = who ? words.forWhom(note, who) : note;
        notes += 1;
        break;
      }
      case 'note_deleted': {
        const added = eventsById.get(event.payload.noteEventId);
        if (added?.type !== 'note_added') continue;
        reached = existing(added.rowIds);
        text = words.noteDeleted(added.payload.text);
        break;
      }
      case 'import':
      case 'undo':
        continue;
    }
    const houseKey = reached[0]?.houseKey ?? null;
    lines.push({
      eventId: event.id,
      at: event.at,
      houseKey,
      address: houseKey === null ? words.noAddress : addressOf(houseKey),
      text,
      details,
    });
  }

  return {
    day: input.day,
    counts: statuses.flatMap((status) => {
      const count = counts.get(status.id);
      return count && count.direct + count.viaLot > 0
        ? [{ statusId: status.id, label: status.label, color: status.color, ...count }]
        : [];
    }),
    corrections,
    calls,
    notes,
    lines,
  };
}

/** "26.09.2026" from "2026-09-26", in the date part of the date format. */
export function formatDay(day: string, format: string): string {
  const [datePart = format] = format.split(' ');
  return formatTime(`${day}T00:00Z`, datePart);
}

/** The day log as text, to copy or share (§5.7). */
export function dayLogText(
  log: DayLog,
  campaignName: string,
  format: string,
  words: DayLogWords,
): string {
  const summary = [
    ...log.counts.map((count) => words.statusCount(count.label, count.direct, count.viaLot)),
    ...(log.corrections > 0 ? [words.corrections(log.corrections)] : []),
    ...(log.calls > 0 ? [words.calls(log.calls)] : []),
    ...(log.notes > 0 ? [words.notes(log.notes)] : []),
  ];
  const indent = ' '.repeat(7);
  const lines = log.lines.flatMap((line) => [
    `${formatTime(line.at, 'HH:mm')}  ${line.address}  ${line.text}`,
    ...line.details.map((detail) => `${indent}${detail}`),
  ]);
  return [
    words.title(campaignName, formatDay(log.day, format)),
    summary.length > 0 ? summary.join(' · ') : words.nothing,
    ...(lines.length > 0 ? ['', ...lines] : []),
  ].join('\n');
}

import { applyToRows, type LotMark, type StatusFields, type StatusSetEvent } from './events.ts';
import { currentReader, currentValue, displayName } from './identity.ts';
import type { ColumnRoles, Row, Status } from './types.ts';

/** What an action changes: its event, and the rows it changed with their new values. */
export interface Planned<Event> {
  event: Event;
  rows: Row[];
}

export interface StatusChangeInput {
  eventId: string;
  campaignId: string;
  now: string;
  /** The house the tap was made at. */
  houseKey: string;
  /** The house rail, or one row's own rail ("This row only"). */
  target: 'house' | 'row';
  /** The rows marked directly: every row at the house, or one row. */
  targetRows: readonly Row[];
  /** Rows of the targets' lots at other houses. */
  lotRowsElsewhere: readonly Row[];
  statuses: readonly Status[];
  statusId: string;
  roles: ColumnRoles;
  /** Settings → Lots: rows closed from the lot get Visit date (Alex, 2026-10-01: yes). */
  fillVisitDateViaLot: boolean;
}

const byFileOrder = (a: Row, b: Row): number => a.rowIndex - b.rowIndex;

/** The owners at a house, in file order, each once ("Alain Trempette", "Marie Trempette"). */
export function ownerNames(rows: readonly Row[], roles: ColumnRoles): string[] {
  const names: string[] = [];
  for (const row of [...rows].sort(byFileOrder)) {
    const name = displayName(currentReader(row, roles));
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? '').trim();
}

function lotMark(status: Status, targets: readonly Row[], roles: ColumnRoles): LotMark {
  const address = targets
    .map((row) => firstLine(currentValue(row, roles.street)))
    .find((street) => street !== '');
  return {
    mode: status.scope === 'lot' ? 'spread' : 'note',
    statusLabel: status.label,
    names: ownerNames(targets, roles),
    address: address ?? '',
    parcelId: firstLine(targets[0]?.parcelIdRaw ?? ''),
  };
}

function statusFields(row: Row): StatusFields {
  return {
    statusId: row.statusId,
    packageStatusText: row.packageStatusText,
    visitDate: row.visitDate,
    origin: row.origin,
    touched: row.touched,
  };
}

/**
 * What one tap on a status changes (with Alex's rules of 2026-10-01).
 *
 * - The target rows get the status, its Package status text and Visit date; nothing else changes.
 * - A whole-lot status (Given) also marks the same lots' rows at other houses whose status it can
 *   replace (To visit, At door, Skipped); every row of those lots at other houses gets the lot note.
 * - A status that notes the lot (To research) leaves the note on those rows and changes none of them.
 * - Tapping the status every target already has changes nothing, except rows closed from the lot,
 *   which become direct visits; the lot is then reached again from this house.
 * - Mark as to visit (the start status) keeps the last Visit date.
 *
 * Returns null when the tap changes nothing.
 */
export function planStatusChange(input: StatusChangeInput): Planned<StatusSetEvent> | null {
  const status = input.statuses.find((candidate) => candidate.id === input.statusId);
  if (!status) throw new Error(`Unknown status ${input.statusId}`);
  const targets = [...input.targetRows].sort(byFileOrder);
  if (targets.length === 0) return null;

  const everyRowHasIt = targets.every((row) => row.statusId === status.id);
  const written = everyRowHasIt ? targets.filter((row) => row.origin !== null) : targets;
  if (written.length === 0) return null;

  const targetIds = new Set(targets.map((row) => row.rowId));
  const lotKeys = new Set(targets.flatMap((row) => row.lotKeys));
  const reachesLot = status.scope === 'lot' || status.notesLot;
  const seen = new Set<string>();
  const elsewhere = reachesLot
    ? input.lotRowsElsewhere
        .filter((row) => {
          if (seen.has(row.rowId) || targetIds.has(row.rowId)) return false;
          seen.add(row.rowId);
          return row.houseKey !== input.houseKey && row.lotKeys.some((key) => lotKeys.has(key));
        })
        .sort(byFileOrder)
    : [];
  const replaceable = (row: Row): boolean =>
    input.statuses.find((candidate) => candidate.id === row.statusId)?.replaceableByLot ?? false;
  const lotAffected = elsewhere.map((row) => ({
    rowId: row.rowId,
    statusChanged: status.scope === 'lot' && row.statusId !== status.id && replaceable(row),
  }));
  const closed = elsewhere.filter((_, i) => lotAffected[i]?.statusChanged === true);

  const changed = [...written, ...closed];
  const event: StatusSetEvent = {
    id: input.eventId,
    campaignId: input.campaignId,
    type: 'status_set',
    at: input.now,
    rowIds: [...written, ...elsewhere].map((row) => row.rowId),
    houseKey: input.houseKey,
    payload: {
      statusId: status.id,
      packageStatusText: status.packageStatusText,
      target: input.target,
      targetRowIds: targets.map((row) => row.rowId),
      writtenRowIds: written.map((row) => row.rowId),
      stampsVisitDate: !status.isStartStatus,
      lot: elsewhere.length > 0 ? lotMark(status, targets, input.roles) : null,
      lotAffected,
      lotVisitDate: input.fillVisitDateViaLot,
      previous: Object.fromEntries(changed.map((row) => [row.rowId, statusFields(row)])),
    },
    exportedAt: null,
  };
  return { event, rows: applyToRows(changed, event) };
}

import { APP_ROLES, MY_MAPS_COLUMNS, myMapsColumnOf } from './columns.ts';
import { DATE_FORMATS, formatTime, isTerrainTime } from './format.ts';
import { fingerprintOf, myMapsValue, readerFor, samePosition, type House } from './identity.ts';
import { withoutOwnNotes } from './notes.ts';
import { splitParcelIds } from './parcel.ts';
import {
  applyIdentity,
  createRow,
  incomingAppFields,
  statusIdFor,
  type RowContext,
} from './rows.ts';
import { compactKey } from './text.ts';
import type { AppField, Campaign, IncomingRow, LatLng, Row, Status } from './types.ts';

/** Journal columns for values that are not spreadsheet columns. */
export const PARCEL_ID_COLUMN = MY_MAPS_COLUMNS.parcelId;
export const POSITION_COLUMN = 'Position';
export const STATUS_COLUMN = 'Status';

export interface ImportChange {
  rowId: string;
  column: string;
  previous: string;
  next: string;
}

export interface Conflict {
  rowId: string;
  column: string;
  local: string;
  incoming: string;
}

export interface MergeInput {
  campaign: Pick<Campaign, 'id' | 'roles' | 'colorMap' | 'lotColumn'>;
  existing: readonly Row[];
  incoming: readonly IncomingRow[];
  statuses: readonly Status[];
  now: string;
  newId: () => string;
  /** Per existing row, the notes Terrain may have written into an export (`ownNoteTexts`). */
  ownNotes?: ReadonlyMap<string, readonly string[]>;
}

export interface MergeResult {
  /** Every row, identity applied, in export order. */
  rows: Row[];
  houses: House[];
  added: string[];
  /** Matched through the parcel ID alone: the name or address changed in the client's file. */
  ownerDetailsChanged: string[];
  /** Matched rows whose imported values changed. */
  updated: string[];
  unchanged: string[];
  /** Kept and flagged: in the campaign but not in this file. */
  missing: string[];
  /** Rows the client's file lists twice, identical in every client column. All are kept. */
  duplicates: string[][];
  conflicts: Conflict[];
  /** Corrections the client's file now agrees with: the edited mark goes away. */
  absorbed: { rowId: string; column: string }[];
  /** Every imported value that changed, with its previous value (Journal: Import update). */
  changes: ImportChange[];
}

export function formatPosition(position: LatLng | null): string {
  return position ? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}` : '';
}

type AppRowField = 'packageStatusText' | 'visitDate' | 'callDate' | 'callResult';

const APP_FIELDS: readonly {
  field: AppRowField;
  touch: AppField;
  role: 'packageStatus' | 'visitDate' | 'callDate' | 'callResult';
}[] = [
  { field: 'packageStatusText', touch: 'packageStatus', role: 'packageStatus' },
  { field: 'visitDate', touch: 'visitDate', role: 'visitDate' },
  { field: 'callDate', touch: 'callDate', role: 'callDate' },
  { field: 'callResult', touch: 'callResult', role: 'callResult' },
];

/**
 * Whether a file's value is Terrain's own, back from an export: the same text, or a time Terrain
 * wrote, in any of the date formats an export may have used.
 */
function sameAppValue(local: string, incoming: string): boolean {
  if (local === incoming) return true;
  return (
    isTerrainTime(local) &&
    DATE_FORMATS.some((format) => formatTime(local, format) === incoming.trim())
  );
}

function mergeRow(
  existing: Row,
  incoming: IncomingRow,
  rowIndex: number,
  context: RowContext,
  ownNotes: readonly string[],
): {
  row: Row;
  changes: ImportChange[];
  conflicts: Conflict[];
  absorbed: { rowId: string; column: string }[];
} {
  const { rowId } = existing;
  const { roles } = context;
  const changes: ImportChange[] = [];
  const conflicts: Conflict[] = [];
  const absorbed: { rowId: string; column: string }[] = [];
  const fromFile = incomingAppFields(incoming, roles);
  // Terrain's notes come back inside the Notes cell of its own exports: they are events, not the client's.
  const importedNotes = withoutOwnNotes(fromFile.importedNotes, ownNotes);

  // Imported values always take the file's values; every change keeps its previous value. Terrain's
  // own values coming back from an export (Package status, its dates, its notes) are no news.
  const columns = new Set([...Object.keys(existing.sourceFields), ...Object.keys(incoming.fields)]);
  for (const column of columns) {
    const previous = existing.sourceFields[column] ?? '';
    const next = incoming.fields[column] ?? '';
    if (previous === next) continue;
    if (column === roles.notes) {
      if (importedNotes.trim() !== existing.importedNotes.trim())
        changes.push({ rowId, column, previous: existing.importedNotes, next: importedNotes });
      continue;
    }
    const app = APP_FIELDS.find((entry) => roles[entry.role] === column);
    if (app && sameAppValue(existing[app.field], next)) continue;
    const mine = myMapsColumnOf(column, roles);
    if (mine && myMapsValue(existing, mine, roles) === next.trim()) continue;
    changes.push({ rowId, column, previous, next });
  }
  if (existing.parcelIdRaw !== incoming.parcelIdRaw) {
    changes.push({
      rowId,
      column: PARCEL_ID_COLUMN,
      previous: existing.parcelIdRaw,
      next: incoming.parcelIdRaw,
    });
  }
  // A file without coordinates for this row says nothing about its position: keep the one we have.
  // A house Alex moved, back from My Maps where his export put it, is no news either.
  const importedPosition = incoming.position ?? existing.importedPosition;
  const movedHere = existing.touched.moved && samePosition(importedPosition, existing.position);
  if (!samePosition(existing.importedPosition, importedPosition) && !movedHere) {
    changes.push({
      rowId,
      column: POSITION_COLUMN,
      previous: formatPosition(existing.importedPosition),
      next: formatPosition(importedPosition),
    });
  }

  // Local wins wherever Alex acted; a correction the file now agrees with is absorbed.
  const edits: Record<string, string> = {};
  for (const [column, local] of Object.entries(existing.edits)) {
    const fileValue = incoming.fields[column] ?? '';
    if (fileValue === local) {
      absorbed.push({ rowId, column });
    } else {
      edits[column] = local;
      conflicts.push({ rowId, column, local, incoming: fileValue });
    }
  }

  let position = importedPosition;
  if (existing.touched.moved) {
    position = existing.position;
    if (incoming.position && !samePosition(incoming.position, existing.position)) {
      conflicts.push({
        rowId,
        column: POSITION_COLUMN,
        local: formatPosition(existing.position),
        incoming: formatPosition(incoming.position),
      });
    }
  }

  const touched = new Set(existing.touched.appFields);
  const keepLocal = (field: AppRowField): string => {
    const spec = APP_FIELDS.find((entry) => entry.field === field);
    if (!spec || !touched.has(spec.touch)) return fromFile[field];
    if (!sameAppValue(existing[field], fromFile[field])) {
      conflicts.push({
        rowId,
        column: context.roles[spec.role] ?? field,
        local: existing[field],
        incoming: fromFile[field],
      });
    }
    return existing[field];
  };
  const app: Pick<Row, AppRowField | 'importedNotes'> = {
    packageStatusText: keepLocal('packageStatusText'),
    visitDate: keepLocal('visitDate'),
    callDate: keepLocal('callDate'),
    callResult: keepLocal('callResult'),
    // Terrain's own notes are events, never this cell: the imported Notes cell always follows the file.
    importedNotes,
  };

  const incomingStatus = statusIdFor(incoming, context);
  let statusId = incomingStatus;
  if (touched.has('status')) {
    statusId = existing.statusId;
    if (incomingStatus !== existing.statusId) {
      conflicts.push({
        rowId,
        column: STATUS_COLUMN,
        local: existing.statusId,
        incoming: incomingStatus,
      });
    }
  }

  const stillListed = new Set(splitParcelIds(incoming.parcelIdRaw).map(compactKey));
  const changed = changes.length > 0 || absorbed.length > 0;
  return {
    row: {
      ...existing,
      rowIndex,
      layer: incoming.layer,
      parcelIdRaw: incoming.parcelIdRaw,
      oldParcelIds: existing.oldParcelIds.filter((id) => stillListed.has(compactKey(id))),
      fingerprint: fingerprintOf(incoming.parcelIdRaw, readerFor(incoming.fields, context.roles)),
      sourceFields: { ...incoming.fields },
      edits,
      importedPosition,
      position,
      addressText: incoming.addressText ?? (incoming.position ? null : existing.addressText),
      pinColor: incoming.pinColor,
      statusId,
      importedStatusId: incomingStatus,
      ...app,
      missingFromLastImport: false,
      updatedAt: changed ? context.now : existing.updatedAt,
    },
    changes,
    conflicts,
    absorbed,
  };
}

/** How alike a campaign row and a file row are: the columns with equal values, plus the same position. */
function similarity(existing: Row, incoming: IncomingRow): number {
  let score = 0;
  const columns = new Set([...Object.keys(existing.sourceFields), ...Object.keys(incoming.fields)]);
  for (const column of columns) {
    if ((existing.sourceFields[column] ?? '') === (incoming.fields[column] ?? '')) score += 1;
  }
  if (incoming.position && samePosition(existing.importedPosition, incoming.position)) score += 1;
  return score;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** Merges a file into a campaign by BUILD_SPEC §6.4. A first import is a merge into no rows. */
export function mergeImport(input: MergeInput): MergeResult {
  const { campaign, statuses, now, newId } = input;
  const context: RowContext = {
    campaignId: campaign.id,
    roles: campaign.roles,
    statuses,
    colorMap: campaign.colorMap,
    now,
  };
  const existing = [...input.existing].sort((a, b) => a.rowIndex - b.rowIndex);
  const incoming = input.incoming;
  const fingerprints = incoming.map((row) =>
    fingerprintOf(row.parcelIdRaw, readerFor(row.fields, campaign.roles)),
  );

  // 1. Same fingerprint. Several rows can share one (in Alex's files: one owner, one parcel ID,
  //    several cadastre lots), so each file row takes the most similar of them, ties to the first.
  const matchOf: (Row | undefined)[] = new Array<Row | undefined>(incoming.length).fill(undefined);
  const matched = new Set<string>();
  const byFingerprint = groupBy(existing, (row) => row.fingerprint);
  fingerprints.forEach((fingerprint, i) => {
    const candidates = byFingerprint.get(fingerprint);
    const row = incoming[i];
    if (!candidates || candidates.length === 0 || !row) return;
    let best = 0;
    let bestScore = -1;
    candidates.forEach((candidate, k) => {
      const score = similarity(candidate, row);
      if (score > bestScore) {
        best = k;
        bestScore = score;
      }
    });
    const [candidate] = candidates.splice(best, 1);
    if (candidate) {
      matchOf[i] = candidate;
      matched.add(candidate.rowId);
    }
  });

  // 2. One unmatched row on each side of a parcel ID: the same row, with owner details changed.
  const ownerDetailsChanged: string[] = [];
  const unmatchedExisting = groupBy(
    existing.filter((row) => !matched.has(row.rowId)),
    (row) => compactKey(row.parcelIdRaw),
  );
  const unmatchedIncoming = groupBy(
    incoming.map((_, i) => i).filter((i) => !matchOf[i]),
    (i) => compactKey(incoming[i]?.parcelIdRaw ?? ''),
  );
  for (const [parcel, indexes] of unmatchedIncoming) {
    const candidates = unmatchedExisting.get(parcel);
    const onlyIncoming = indexes[0];
    const onlyExisting = candidates?.[0];
    if (
      parcel !== '' &&
      indexes.length === 1 &&
      candidates?.length === 1 &&
      onlyIncoming !== undefined &&
      onlyExisting
    ) {
      matchOf[onlyIncoming] = onlyExisting;
      matched.add(onlyExisting.rowId);
      ownerDetailsChanged.push(onlyExisting.rowId);
    }
  }

  // 3. The rest: added, or kept and flagged missing.
  const next: Row[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const conflicts: Conflict[] = [];
  const absorbed: { rowId: string; column: string }[] = [];
  const changes: ImportChange[] = [];
  const rowIdByIncoming: string[] = [];
  incoming.forEach((row, i) => {
    const match = matchOf[i];
    if (!match) {
      const created = createRow(row, newId(), i, context);
      added.push(created.rowId);
      rowIdByIncoming.push(created.rowId);
      next.push(created);
      return;
    }
    const merged = mergeRow(match, row, i, context, input.ownNotes?.get(match.rowId) ?? []);
    next.push(merged.row);
    rowIdByIncoming.push(match.rowId);
    conflicts.push(...merged.conflicts);
    absorbed.push(...merged.absorbed);
    changes.push(...merged.changes);
    if (merged.changes.length > 0) updated.push(match.rowId);
    else unchanged.push(match.rowId);
  });

  const missing = existing
    .filter((row) => !matched.has(row.rowId))
    .map((row, k) => ({ ...row, rowIndex: incoming.length + k, missingFromLastImport: true }));

  // A duplicate repeats a row of the client's file exactly: Alex's own columns don't count, and
  // rows that differ elsewhere (another NUM_LOT, another phone) are separate rows.
  const appColumns = new Set(APP_ROLES.map((role) => campaign.roles[role]));
  const clientValues = (row: IncomingRow): string =>
    JSON.stringify(
      Object.keys(row.fields)
        .filter((column) => !appColumns.has(column))
        .sort()
        .map((column) => [column, row.fields[column]]),
    );
  const duplicates = [
    ...groupBy(
      incoming.map((row, i) => ({ key: `${fingerprints[i] ?? ''}\u0000${clientValues(row)}`, i })),
      (entry) => entry.key,
    ).values(),
  ]
    .filter((group) => group.length > 1)
    .map((group) => group.map((entry) => rowIdByIncoming[entry.i] ?? ''));

  const identity = applyIdentity([...next, ...missing], campaign);
  return {
    rows: identity.rows,
    houses: identity.houses,
    added,
    ownerDetailsChanged,
    updated,
    unchanged,
    missing: missing.map((row) => row.rowId),
    duplicates,
    conflicts,
    absorbed,
    changes,
  };
}

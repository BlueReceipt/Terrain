import { APP_ROLES, MY_MAPS_COLUMNS, myMapsColumnOf } from './columns.ts';
import type { ImportedOwner } from './events.ts';
import { DATE_FORMATS, formatTime, isTerrainTime, type DateFormat } from './format.ts';
import {
  currentReader,
  currentValue,
  displayName,
  fingerprintOf,
  myMapsValue,
  readerFor,
  samePosition,
  type FieldReader,
  type House,
} from './identity.ts';
import {
  isNewOwner,
  ownerColumns,
  ownerDetails,
  previousInfoColumn,
  previousVisit,
  withPreviousOwner,
  type PreviousInfoWords,
} from './newOwner.ts';
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
  campaign: Pick<Campaign, 'id' | 'roles' | 'colorMap' | 'lotColumn' | 'columnOrder'>;
  existing: readonly Row[];
  incoming: readonly IncomingRow[];
  statuses: readonly Status[];
  now: string;
  newId: () => string;
  /** Per existing row, the notes Terrain may have written into an export (`ownNoteTexts`). */
  ownNotes?: ReadonlyMap<string, readonly string[]>;
  /** How Previous info is written for a new owner the file names; without it, a new name is only owner details changed. */
  previousInfo?: { words: PreviousInfoWords; format: DateFormat };
}

/** A new owner the file names, and what goes to Previous info. */
interface Replacement {
  /** The owner columns: the old owner's corrections there go. */
  columns: string[];
  column: string;
  entry: string;
  previous: string;
  next: string;
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
  /** Rows whose owner the file replaced by someone else (Alex, 2026-10-06). */
  newOwners: ImportedOwner[];
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
  replace: Replacement | null,
): {
  row: Row;
  changes: ImportChange[];
  conflicts: Conflict[];
  absorbed: { rowId: string; column: string }[];
  newOwner: ImportedOwner | null;
} {
  const { rowId } = existing;
  const { roles } = context;
  const changes: ImportChange[] = [];
  const conflicts: Conflict[] = [];
  const absorbed: { rowId: string; column: string }[] = [];
  // A column this file doesn't have says nothing about it (Alex, 2026-10-06): its values stay.
  const inFile = (column: string) => column in incoming.fields;
  const sourceFields = {
    ...Object.fromEntries(Object.entries(existing.sourceFields).filter(([c]) => !inFile(c))),
    ...incoming.fields,
  };
  const fromFile = incomingAppFields({ fields: sourceFields }, roles);
  // Terrain's notes come back inside the Notes cell of its own exports: they are events, not the client's.
  const importedNotes = withoutOwnNotes(fromFile.importedNotes, ownNotes);

  // Imported values always take the file's values; every change keeps its previous value. Terrain's
  // own values coming back from an export (Package status, its dates, its notes) are no news.
  const columns = new Set([...Object.keys(existing.sourceFields), ...Object.keys(incoming.fields)]);
  for (const column of columns) {
    if (!inFile(column)) continue;
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

  // Local wins wherever Alex acted; a correction the file now agrees with is absorbed. A file
  // without the column (Previous info, Terrain's own, never is in the client's) says nothing about
  // it. For a new owner, the old owner's corrections go.
  const dropped = replace
    ? Object.keys(existing.edits).filter((column) => replace.columns.includes(column))
    : [];
  const edits: Record<string, string> = {};
  for (const [column, local] of Object.entries(existing.edits)) {
    if (dropped.includes(column) || column === replace?.column) continue;
    if (!inFile(column)) {
      edits[column] = local;
      continue;
    }
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

  // A new owner starts over at the file's status and dates (Alex, 2026-10-06: "always start over").
  const touched = new Set(replace ? [] : existing.touched.appFields);
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

  const incomingStatus = statusIdFor(
    { pinColor: incoming.pinColor, fields: sourceFields },
    context,
  );
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

  let newOwner: ImportedOwner | null = null;
  if (replace) {
    const previousEdit = existing.edits[replace.column] ?? null;
    const nextEdit = withPreviousOwner(currentValue(existing, replace.column), replace.entry);
    edits[replace.column] = nextEdit;
    newOwner = {
      rowId,
      previous: replace.previous,
      next: replace.next,
      column: replace.column,
      previousEdit,
      nextEdit,
      dropped,
      previousStatusId: existing.statusId,
      nextStatusId: statusId,
    };
  }

  const stillListed = new Set(splitParcelIds(incoming.parcelIdRaw).map(compactKey));
  const changed = changes.length > 0 || absorbed.length > 0;
  return {
    row: {
      ...existing,
      ...(replace && {
        origin: null,
        touched: { appFields: [], moved: existing.touched.moved },
      }),
      rowIndex,
      layer: incoming.layer,
      parcelIdRaw: incoming.parcelIdRaw,
      oldParcelIds: existing.oldParcelIds.filter((id) => stillListed.has(compactKey(id))),
      fingerprint: fingerprintOf(incoming.parcelIdRaw, readerFor(sourceFields, context.roles)),
      sourceFields,
      edits,
      importedPosition,
      position,
      // A position found from the address stays until the file brings coordinates of its own.
      placed: incoming.position ? null : existing.placed,
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
    newOwner,
  };
}

/**
 * When the file names someone else (`isNewOwner`) than both its last version and the owner Terrain
 * has: a file that hasn't caught up with a New owner made at the door, or that now agrees with it,
 * is no new owner. What goes to Previous info: the owner as Terrain had them and the visit they
 * had ("Given 26.09.2026"), dated today.
 */
function replacementOf(
  existing: Row,
  incoming: IncomingRow,
  input: MergeInput,
): Replacement | null {
  if (!input.previousInfo) return null;
  const { roles } = input.campaign;
  const before = currentReader(existing, roles);
  const after = readerFor(incoming.fields, roles);
  if (!isNewOwner(readerFor(existing.sourceFields, roles), after) || !isNewOwner(before, after))
    return null;
  const { words, format } = input.previousInfo;
  const [datePart = format] = format.split(' ');
  const columns = ownerColumns(input.campaign.columnOrder, roles);
  const visit = previousVisit(existing, input.statuses, words, format);
  const details = [ownerDetails(existing, columns, roles), visit].filter(Boolean).join(', ');
  return {
    columns,
    column: previousInfoColumn(input.campaign.columnOrder),
    entry: words.previousOwner(details, formatTime(input.now, datePart)),
    previous: displayName(before),
    next: displayName(after),
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

/** Merges a file into a campaign. A first import is a merge into no rows. */
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
  const { roles } = campaign;
  const fingerprints = incoming.map((row) =>
    fingerprintOf(row.parcelIdRaw, readerFor(row.fields, roles)),
  );
  // A file without some of the columns that tell rows apart (the names, the address) is matched on
  // what both have (Alex, 2026-10-06): no row comes in twice for a column the file left out.
  const present = new Set(incoming.flatMap((row) => Object.keys(row.fields)));
  const partial = (['salutation', 'firstName', 'lastName', 'company', 'street'] as const).some(
    (role) => roles[role] !== undefined && !present.has(roles[role]),
  );
  const onShared =
    (read: FieldReader): FieldReader =>
    (role) => {
      const column = roles[role];
      return column !== undefined && present.has(column) ? read(role) : '';
    };
  const keyOf = (row: Row) =>
    partial
      ? fingerprintOf(row.parcelIdRaw, onShared(readerFor(row.sourceFields, roles)))
      : row.fingerprint;

  // 1. Same fingerprint. Several rows can share one (in Alex's files: one owner, one parcel ID,
  //    several cadastre lots), so each file row takes the most similar of them, ties to the first.
  const matchOf: (Row | undefined)[] = new Array<Row | undefined>(incoming.length).fill(undefined);
  const matched = new Set<string>();
  const byFingerprint = groupBy(existing, keyOf);
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
  const newOwners: ImportedOwner[] = [];
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
    const merged = mergeRow(
      match,
      row,
      i,
      context,
      input.ownNotes?.get(match.rowId) ?? [],
      replacementOf(match, row, input),
    );
    next.push(merged.row);
    rowIdByIncoming.push(match.rowId);
    conflicts.push(...merged.conflicts);
    absorbed.push(...merged.absorbed);
    changes.push(...merged.changes);
    if (merged.newOwner) newOwners.push(merged.newOwner);
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
    newOwners,
  };
}

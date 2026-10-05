import {
  currentReader,
  displayName,
  lotsAcrossHouses,
  sharedPoints,
  spreadHouses,
  type House,
} from './identity.ts';
import type { Conflict, MergeResult } from './merge.ts';
import { splitParcelIds } from './parcel.ts';
import { compactKey, fold } from './text.ts';
import type { ColumnRoles, IncomingRow, LatLng, Row } from './types.ts';

export interface RowSummary {
  rowId: string;
  parcelId: string;
  owner: string;
  address: string;
}

export interface HouseSummary {
  houseKey: string;
  address: string;
  town: string;
  rows: RowSummary[];
}

export interface ColorSummary {
  color: string;
  count: number;
  statusId: string | null;
  /** Most common Package status texts on pins of this color, as a hint of what the color meant. */
  texts: string[];
}

export interface ImportReport {
  fileName: string;
  rowsInFile: number;
  added: number;
  updated: number;
  unchanged: number;
  ownerDetailsChanged: RowSummary[];
  conflicts: (Conflict & { row: RowSummary })[];
  duplicates: RowSummary[][];
  missing: RowSummary[];
  houseCount: number;
  housesWithSeveralRows: HouseSummary[];
  sharedPoints: HouseSummary[][];
  spreadHouses: HouseSummary[];
  lotsAcrossHouses: { lotKey: string; houses: HouseSummary[] }[];
  housesWithoutPosition: HouseSummary[];
  severalParcelIds: { row: RowSummary; ids: string[]; oldIds: string[] }[];
  colors: ColorSummary[];
  referenceFeatures: number;
  layers: string[];
  /** Most parcel IDs of the file are unknown to the campaign: offer a new campaign instead. */
  mostlyNewParcelIds: boolean;
}

export function summarizeRow(row: Row, roles: ColumnRoles): RowSummary {
  const read = currentReader(row, roles);
  const street = (read('street').split(/\r?\n/)[0] ?? '').trim();
  const town = read('town').trim();
  return {
    rowId: row.rowId,
    parcelId: splitParcelIds(row.parcelIdRaw).join(' / '),
    owner: displayName(read),
    address: [street, town].filter(Boolean).join(', '),
  };
}

function summarizeHouse(
  house: House,
  rowsById: ReadonlyMap<string, Row>,
  roles: ColumnRoles,
): HouseSummary {
  const rows = house.rowIds
    .map((id) => rowsById.get(id))
    .filter((row): row is Row => row !== undefined);
  const first = rows[0];
  const read = first ? currentReader(first, roles) : () => '';
  return {
    houseKey: house.houseKey,
    address: (read('street').split(/\r?\n/)[0] ?? '').trim(),
    town: read('town').trim(),
    rows: rows.map((row) => summarizeRow(row, roles)),
  };
}

function byTownThenAddress(a: HouseSummary, b: HouseSummary): number {
  return fold(a.town).localeCompare(fold(b.town)) || fold(a.address).localeCompare(fold(b.address));
}

export function colorSummaries(
  incoming: readonly IncomingRow[],
  roles: ColumnRoles,
  colorMap: Readonly<Record<string, string>>,
): ColorSummary[] {
  const counts = new Map<string, { count: number; texts: Map<string, number> }>();
  for (const row of incoming) {
    if (row.pinColor === null) continue;
    const entry = counts.get(row.pinColor) ?? { count: 0, texts: new Map<string, number>() };
    entry.count += 1;
    const text = roles.packageStatus ? (row.fields[roles.packageStatus] ?? '').trim() : '';
    if (text) entry.texts.set(text, (entry.texts.get(text) ?? 0) + 1);
    counts.set(row.pinColor, entry);
  }
  return [...counts.entries()]
    .map(([color, entry]) => ({
      color,
      count: entry.count,
      statusId: colorMap[color] ?? null,
      texts: [...entry.texts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([text]) => text),
    }))
    .sort((a, b) => b.count - a.count);
}

export function buildReport(input: {
  fileName: string;
  incoming: readonly IncomingRow[];
  referenceFeatures: number;
  layers: string[];
  roles: ColumnRoles;
  colorMap: Readonly<Record<string, string>>;
  merge: MergeResult;
  existingParcelKeys: ReadonlySet<string>;
}): ImportReport {
  const { merge, roles } = input;
  const rowsById = new Map(merge.rows.map((row) => [row.rowId, row]));
  const houseByKey = new Map(merge.houses.map((house) => [house.houseKey, house]));
  const house = (h: House): HouseSummary => summarizeHouse(h, rowsById, roles);
  const row = (id: string): RowSummary | null => {
    const found = rowsById.get(id);
    return found ? summarizeRow(found, roles) : null;
  };
  const rows = (ids: readonly string[]): RowSummary[] =>
    ids.map(row).filter((summary): summary is RowSummary => summary !== null);
  const positions = new Map<string, LatLng | null>(merge.rows.map((r) => [r.rowId, r.position]));

  let mostlyNewParcelIds = false;
  if (input.existingParcelKeys.size > 0) {
    const incomingKeys = new Set(
      input.incoming.flatMap((r) => splitParcelIds(r.parcelIdRaw).map(compactKey)),
    );
    const known = [...incomingKeys].filter((key) => input.existingParcelKeys.has(key)).length;
    mostlyNewParcelIds = incomingKeys.size > 0 && known / incomingKeys.size < 0.5;
  }

  return {
    fileName: input.fileName,
    rowsInFile: input.incoming.length,
    added: merge.added.length,
    updated: merge.updated.length,
    unchanged: merge.unchanged.length,
    ownerDetailsChanged: rows(merge.ownerDetailsChanged),
    conflicts: merge.conflicts.flatMap((conflict) => {
      const summary = row(conflict.rowId);
      return summary ? [{ ...conflict, row: summary }] : [];
    }),
    duplicates: merge.duplicates.map(rows),
    missing: rows(merge.missing),
    houseCount: merge.houses.length,
    housesWithSeveralRows: merge.houses.filter((h) => h.rowIds.length > 1).map(house),
    sharedPoints: sharedPoints(merge.houses).map((group) => group.map(house)),
    spreadHouses: spreadHouses(merge.houses, positions).map(house),
    lotsAcrossHouses: lotsAcrossHouses(merge.rows).map(({ lotKey, houseKeys }) => ({
      lotKey,
      houses: houseKeys
        .map((key) => houseByKey.get(key))
        .filter((h): h is House => h !== undefined)
        .map(house),
    })),
    housesWithoutPosition: merge.houses
      .filter((h) => !h.position)
      .map(house)
      .sort(byTownThenAddress),
    severalParcelIds: merge.rows
      .filter((r) => splitParcelIds(r.parcelIdRaw).length > 1)
      .map((r) => ({
        row: summarizeRow(r, roles),
        ids: splitParcelIds(r.parcelIdRaw),
        oldIds: r.oldParcelIds,
      })),
    colors: colorSummaries(input.incoming, roles, input.colorMap),
    referenceFeatures: input.referenceFeatures,
    layers: input.layers,
    mostlyNewParcelIds,
  };
}

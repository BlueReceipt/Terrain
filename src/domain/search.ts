import { headerKey } from './columns.ts';
import { currentReader, currentValue, displayName } from './identity.ts';
import { compactKey, fold } from './text.ts';
import type { Campaign, ColumnRoles, Row } from './types.ts';

/**
 * A row found by its parcel ID, owner, address, or any other cell of the file: it opens its house
 * with the row highlighted.
 */
export interface RowResult {
  kind: 'row';
  rowId: string;
  houseKey: string;
  parcelId: string;
  name: string;
  address: string;
  match: 'parcel' | 'owner' | 'address' | 'cell';
  /** The cell that matched, when it is none of the above: its column and the line that matched. */
  cell?: { column: string; value: string };
}

/** A lot number: it lists every house of that lot. */
export interface LotResult {
  kind: 'lot';
  column: string;
  value: string;
  houseKeys: string[];
}

export type SearchResult = RowResult | LotResult;

/** NUM_LOT, Anc_lot, and any designation column ("désignation": a lot's number in Québec). */
function holdsLotNumbers(column: string): boolean {
  const key = headerKey(column);
  return key === 'numlot' || key === 'anclot' || key.includes('designation');
}

/** Columns holding lot numbers: the campaign's lot column, then the usual lot number columns. */
function lotColumns(campaign: Pick<Campaign, 'columnOrder' | 'lotColumn'>): string[] {
  const columns = campaign.columnOrder.filter(holdsLotNumbers);
  if (campaign.lotColumn && !columns.includes(campaign.lotColumn))
    columns.unshift(campaign.lotColumn);
  return columns;
}

/** How well a text matches: 3 equal, 2 starts with it, 1 contains it, 0 not at all. */
function score(text: string, query: string): number {
  if (!query || !text) return 0;
  if (text === query) return 3;
  if (text.startsWith(query)) return 2;
  return text.includes(query) ? 1 : 0;
}

/** Letters and digits only: how IDs, lot numbers and phone numbers compare. */
const idKey = (text: string) => compactKey(text).replace(/[^0-9A-Z]/g, '');

interface CellLine {
  line: string;
  folded: string;
  compact: string;
}

/**
 * Each cell's lines, ready to compare. Worked out once per row and column, then reused while the
 * user types: rows are never changed in place (a correction makes a new row), so they can't go
 * stale.
 */
const cellLines = new WeakMap<Row, Map<string, CellLine[]>>();

function linesOf(row: Row, column: string): CellLine[] {
  let columns = cellLines.get(row);
  if (!columns) {
    columns = new Map();
    cellLines.set(row, columns);
  }
  let lines = columns.get(column);
  if (!lines) {
    lines = currentValue(row, column)
      .split(/\r?\n/)
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((line) => ({ line, folded: fold(line), compact: idKey(line) }));
    columns.set(column, lines);
  }
  return lines;
}

interface RowText {
  roles: ColumnRoles;
  name: string;
  address: string;
  parcel: string;
  /** The whole name, then first name, last name and company: an exact last name is an exact owner. */
  owner: string[];
  street: string;
}

/** A row's parcel ID, owner and address, ready to compare: kept while the columns' roles stay. */
const rowTexts = new WeakMap<Row, RowText>();

function rowTextOf(row: Row, roles: ColumnRoles): RowText {
  const known = rowTexts.get(row);
  if (known?.roles === roles) return known;
  const read = currentReader(row, roles);
  const name = displayName(read);
  const address = (read('street').split(/\r?\n/)[0] ?? '').trim();
  const text: RowText = {
    roles,
    name,
    address,
    parcel: idKey(row.parcelIdRaw),
    owner: [name, read('firstName'), read('lastName'), read('company')].map((part) => fold(part)),
    street: fold(address),
  };
  rowTexts.set(row, text);
  return text;
}

/** The best line of a cell, read as words or as an ID: a long Notes cell shows the line that matched. */
function bestLine(
  lines: readonly CellLine[],
  folded: string,
  compact: string,
): { line: string; quality: number } {
  let best = { line: '', quality: 0 };
  for (const line of lines) {
    const quality = Math.max(score(line.folded, folded), score(line.compact, compact));
    if (quality > best.quality) best = { line: line.line, quality };
  }
  return best;
}

/**
 * The search field: parcel ID, owner name, lot number, address, and every other cell of the file,
 * columns Terrain doesn't know included; corrected values too. Accents, case, spaces and
 * punctuation don't matter.
 */
export function search(
  rows: readonly Row[],
  campaign: Pick<Campaign, 'columnOrder' | 'lotColumn' | 'roles'>,
  query: string,
  limit = 20,
): SearchResult[] {
  const folded = fold(query);
  const compact = idKey(query);
  if (folded.length < 2 && compact.length < 2) return [];
  const lots = lotColumns(campaign);
  // The owner's name parts and the street are searched as the owner and the address.
  const asOwnerOrAddress = new Set(
    (['firstName', 'lastName', 'company', 'salutation', 'street'] as const).map(
      (role) => campaign.roles[role],
    ),
  );
  const otherColumns = campaign.columnOrder.filter(
    (column) => !lots.includes(column) && !asOwnerOrAddress.has(column),
  );

  const rowResults: { result: RowResult; rank: number }[] = [];
  for (const row of rows) {
    const { name, address, ...text } = rowTextOf(row, campaign.roles);
    const parcel = score(text.parcel, compact);
    const owner = Math.max(...text.owner.map((part) => score(part, folded)));
    const street = score(text.street, folded);
    let cell: { column: string; value: string } | null = null;
    let inCell = 0;
    // Another cell can't outrank an exact parcel ID, owner or address.
    if (Math.max(parcel, owner, street) < 3) {
      for (const column of otherColumns) {
        const lines = linesOf(row, column);
        if (lines.length === 0) continue;
        const found = bestLine(lines, folded, compact);
        if (found.quality > inCell) {
          inCell = found.quality;
          cell = { column, value: found.line };
        }
        if (inCell === 3) break;
      }
    }
    const best = Math.max(parcel, owner, street, inCell);
    if (best === 0) continue;
    const match =
      parcel === best ? 'parcel' : owner === best ? 'owner' : street === best ? 'address' : 'cell';
    rowResults.push({
      result: {
        kind: 'row',
        rowId: row.rowId,
        houseKey: row.houseKey,
        parcelId: row.parcelIdRaw,
        name,
        address,
        match,
        ...(match === 'cell' && cell ? { cell } : {}),
      },
      // At equal quality: parcel IDs first (they're what Alex types most), other cells last.
      rank:
        best * 10 + (match === 'parcel' ? 2 : match === 'owner' ? 1 : match === 'address' ? 0 : -1),
    });
  }

  const lotResults = new Map<string, LotResult & { rank: number }>();
  for (const column of lots) {
    for (const row of rows) {
      const value = currentValue(row, column).trim();
      const rank = score(idKey(value), compact);
      if (rank === 0) continue;
      const key = `${column}\u0000${idKey(value)}`;
      const lot = lotResults.get(key) ?? {
        kind: 'lot',
        column,
        value,
        houseKeys: [],
        rank: rank * 10 + 3,
      };
      if (!lot.houseKeys.includes(row.houseKey)) lot.houseKeys.push(row.houseKey);
      lotResults.set(key, lot);
    }
  }

  return [
    ...[...lotResults.values()].map(({ rank, ...result }) => ({ result, rank })),
    ...rowResults,
  ]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((entry) => entry.result);
}

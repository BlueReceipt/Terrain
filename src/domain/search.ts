import { headerKey } from './columns.ts';
import { currentReader, currentValue, displayName } from './identity.ts';
import { compactKey, fold } from './text.ts';
import type { Campaign, Row } from './types.ts';

/** A row found by its parcel ID, owner or address: it opens its house with the row highlighted. */
export interface RowResult {
  kind: 'row';
  rowId: string;
  houseKey: string;
  parcelId: string;
  name: string;
  address: string;
  match: 'parcel' | 'owner' | 'address';
}

/** A lot number: it lists every house of that lot (§5.2). */
export interface LotResult {
  kind: 'lot';
  column: string;
  value: string;
  houseKeys: string[];
}

export type SearchResult = RowResult | LotResult;

/** Columns holding lot numbers: the campaign's lot column, NUM_LOT and Anc_lot. */
function lotColumns(campaign: Pick<Campaign, 'columnOrder' | 'lotColumn'>): string[] {
  const columns = campaign.columnOrder.filter((column) =>
    ['numlot', 'anclot'].includes(headerKey(column)),
  );
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

/**
 * The search field (§5.2): parcel ID, owner name, lot number and address, corrected values
 * included. Accents, case, spaces and punctuation don't matter.
 */
export function search(
  rows: readonly Row[],
  campaign: Pick<Campaign, 'columnOrder' | 'lotColumn' | 'roles'>,
  query: string,
  limit = 20,
): SearchResult[] {
  const folded = fold(query);
  const compact = compactKey(query).replace(/[^0-9A-Z]/g, '');
  if (folded.length < 2 && compact.length < 2) return [];
  const idKey = (text: string) => compactKey(text).replace(/[^0-9A-Z]/g, '');

  const rowResults: { result: RowResult; rank: number }[] = [];
  for (const row of rows) {
    const read = currentReader(row, campaign.roles);
    const name = displayName(read);
    const address = (read('street').split(/\r?\n/)[0] ?? '').trim();
    const parcel = score(idKey(row.parcelIdRaw), compact);
    const owner = score(fold(name), folded);
    const street = score(fold(address), folded);
    const best = Math.max(parcel, owner, street);
    if (best === 0) continue;
    const match = parcel === best ? 'parcel' : owner === best ? 'owner' : 'address';
    rowResults.push({
      result: {
        kind: 'row',
        rowId: row.rowId,
        houseKey: row.houseKey,
        parcelId: row.parcelIdRaw,
        name,
        address,
        match,
      },
      // Parcel IDs first at equal quality: they're what Alex types most.
      rank: best * 10 + (match === 'parcel' ? 2 : match === 'owner' ? 1 : 0),
    });
  }

  const lots = new Map<string, LotResult & { rank: number }>();
  for (const column of lotColumns(campaign)) {
    for (const row of rows) {
      const value = currentValue(row, column).trim();
      const rank = score(idKey(value), compact);
      if (rank === 0) continue;
      const key = `${column}\u0000${idKey(value)}`;
      const lot = lots.get(key) ?? {
        kind: 'lot',
        column,
        value,
        houseKeys: [],
        rank: rank * 10 + 3,
      };
      if (!lot.houseKeys.includes(row.houseKey)) lot.houseKeys.push(row.houseKey);
      lots.set(key, lot);
    }
  }

  return [...[...lots.values()].map(({ rank, ...result }) => ({ result, rank })), ...rowResults]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((entry) => entry.result);
}

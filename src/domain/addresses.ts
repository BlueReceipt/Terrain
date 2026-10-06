import { currentReader, type House } from './identity.ts';
import { fold } from './text.ts';
import type { ColumnRoles, LatLng, Row } from './types.ts';

/**
 * What Terrain may send online to find a house: its address, and nothing else. No name, phone
 * number, parcel ID, note or status ever leaves the phone (Alex, 2026-10-05).
 */
export interface AddressQuery {
  street: string;
  town: string;
  postalCode: string;
  province: string;
}

/** One answer of the address service (Adresses Québec), as the relay passes it on. */
export interface AddressCandidate {
  lat: number;
  lng: number;
  /** The civic number; empty for the street itself. */
  number: string;
  street: string;
  town: string;
  postalCode: string;
}

/** At the house's civic address, or only somewhere on its street. */
export type Precision = 'address' | 'street';

export interface Placement {
  position: LatLng;
  precision: Precision;
}

/** The address of a row from its current values, corrections included; null without a street and town. */
export function addressOf(row: Row, roles: ColumnRoles): AddressQuery | null {
  const read = currentReader(row, roles);
  const street = (read('street').split(/\r?\n/)[0] ?? '').trim();
  const town = read('town').trim();
  if (!street || !town) return null;
  return { street, town, postalCode: read('postalCode').trim(), province: read('province').trim() };
}

/** Adresses Québec knows Québec only; a row says nothing of its province, or says Québec. */
function inQuebec(province: string): boolean {
  const key = fold(province).replace(/[^a-z]/g, '');
  return key === '' || ['qc', 'quebec', 'pq', 'que'].includes(key);
}

/** One key per address, so a street of twin rows is looked up once. */
export function addressKey(query: AddressQuery): string {
  return [query.street, query.town, query.postalCode]
    .map((part) => words(part).join(' '))
    .join('|');
}

/** The houses with no position, each with the address to look up: one per house, Québec only. */
export function housesToFind(
  rows: readonly Row[],
  houses: readonly House[],
  roles: ColumnRoles,
): { houseKey: string; query: AddressQuery }[] {
  const byId = new Map(rows.map((row) => [row.rowId, row]));
  const found: { houseKey: string; query: AddressQuery }[] = [];
  for (const house of houses) {
    if (house.position) continue;
    for (const rowId of house.rowIds) {
      const row = byId.get(rowId);
      const query = row ? addressOf(row, roles) : null;
      if (!query) continue;
      if (inQuebec(query.province)) found.push({ houseKey: house.houseKey, query });
      break;
    }
  }
  return found;
}

// Street types and small words: "780, rue St-Jean" and "Rue Saint-Jean" are the same street.
const IGNORED = new Set([
  'rue',
  'r',
  'chemin',
  'ch',
  'rang',
  'rg',
  'route',
  'rte',
  'boulevard',
  'boul',
  'bd',
  'avenue',
  'av',
  'ave',
  'montee',
  'mtee',
  'place',
  'pl',
  'cote',
  'croissant',
  'cr',
  'impasse',
  'allee',
  'terrasse',
  'promenade',
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'l',
  'd',
  'et',
  'street',
  'road',
  'rd',
]);
const SAME = new Map([
  ['saint', 'st'],
  ['sainte', 'ste'],
  ['mont', 'mt'],
]);

/** A name's words, folded, without street types and small words, "Saint" written "st". */
function words(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => SAME.get(word) ?? word)
    .filter((word) => !IGNORED.has(word));
}

/** "Saint-Hyacinthe" is "St-Hyacinthe" and "ST HYACINTHE". */
function sameName(a: string, b: string): boolean {
  const left = words(a);
  const right = words(b);
  return left.length > 0 && left.join(' ') === right.join(' ');
}

/** The civic number that starts a street address: "780, rue Saint-Jean" → "780". */
function civicNumber(street: string): string {
  return /^\s*(\d+)/.exec(street)?.[1] ?? '';
}

function sameStreet(query: AddressQuery, candidate: AddressCandidate): boolean {
  const asked = words(query.street.replace(/^\s*\d+[a-z]?\b[\s,-]*/i, ''));
  const named = words(candidate.street);
  return named.length > 0 && named.every((word) => asked.includes(word));
}

function sameTownOrPostalCode(query: AddressQuery, candidate: AddressCandidate): boolean {
  const postal = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const asked = postal(query.postalCode);
  return (
    sameName(query.town, candidate.town) ||
    (asked.length === 6 && asked === postal(candidate.postalCode))
  );
}

/**
 * Where the service's answers put the house: the candidate at its civic number, else its street,
 * always in its own town (or at its postal code). Null when no answer is that house's street: a
 * "rang Double" in another town is not the one.
 */
export function placementFor(
  query: AddressQuery,
  candidates: readonly AddressCandidate[],
): Placement | null {
  const number = civicNumber(query.street);
  const fitting = candidates.filter(
    (candidate) => sameStreet(query, candidate) && sameTownOrPostalCode(query, candidate),
  );
  const atAddress = number ? fitting.find((candidate) => candidate.number === number) : undefined;
  const onStreet = fitting.find((candidate) => !candidate.number) ?? fitting[0];
  const chosen = atAddress ?? onStreet;
  if (!chosen) return null;
  return {
    position: { lat: chosen.lat, lng: chosen.lng },
    precision: atAddress ? 'address' : 'street',
  };
}

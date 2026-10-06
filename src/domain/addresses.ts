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

/** One answer of an address service, as the relay passes it on. */
export interface AddressCandidate {
  lat: number;
  lng: number;
  /** The civic number; empty for the street itself. */
  number: string;
  street: string;
  town: string;
  postalCode: string;
  /**
   * The service estimated the place along the street from the civic number (Natural Resources
   * Canada, outside Québec) instead of knowing the house: on the street, to check at the door.
   */
  estimated?: boolean;
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

// Canada's provinces and territories, by code or name, English or French (Alex, 2026-10-05: Québec
// from Adresses Québec, the rest of Canada from Natural Resources Canada; elsewhere, none).
const CANADA = new Set(
  'qc quebec pq que on ontario nb newbrunswick nouveaubrunswick ns novascotia nouvelleecosse pe pei princeedwardisland ileduprinceedouard nl newfoundland newfoundlandandlabrador terreneuve terreneuveetlabrador mb manitoba sk saskatchewan ab alberta bc britishcolumbia colombiebritannique yt yukon nt northwestterritories territoiresdunordouest nu nunavut'.split(
    ' ',
  ),
);

/** The address services know Canada; a row says nothing of its province, or names one of Canada's. */
function inCanada(province: string): boolean {
  const key = fold(province).replace(/[^a-z]/g, '');
  return key === '' || CANADA.has(key);
}

/** One key per address, so a street of twin rows is looked up once. */
export function addressKey(query: AddressQuery): string {
  return [query.street, query.town, query.postalCode]
    .map((part) => words(part).join(' '))
    .join('|');
}

/** The houses with no position, each with the address to look up: one per house, in Canada. */
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
      if (inCanada(query.province)) found.push({ houseKey: house.houseKey, query });
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

// Street types, French and English, each spelling to one: "ch." is "chemin", "Dr" is "drive".
const TYPES = new Map<string, string>(
  Object.entries({
    rue: ['r'],
    chemin: ['ch'],
    rang: ['rg'],
    route: ['rte'],
    boulevard: ['boul', 'bd', 'blvd'],
    avenue: ['av', 'ave'],
    montee: ['mtee'],
    place: ['pl'],
    cote: [],
    croissant: [],
    impasse: [],
    allee: [],
    terrasse: [],
    promenade: [],
    street: [],
    road: ['rd'],
    drive: ['dr'],
    crescent: ['cres'],
    court: ['crt', 'ct'],
    lane: ['ln'],
    way: [],
    highway: ['hwy'],
    line: [],
    concession: ['conc'],
    sideroad: ['sdrd'],
    trail: ['trl'],
    parkway: ['pkwy'],
    terrace: ['terr'],
    circle: ['cir'],
    square: ['sq'],
  }).flatMap(([type, short]) => [[type, type] as const, ...short.map((s) => [s, type] as const)]),
);
const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'of', 'the']);

/** A street's type and the words of its name: "780, rue St-Jean" is rue and "st jean". */
function streetParts(text: string): { type: string | null; name: string[] } {
  const tokens = fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let type: string | null = null;
  const name: string[] = [];
  tokens.forEach((token, i) => {
    // "St" ends a name as Street ("Main St") and starts one as Saint ("St-Jean", "St Clair Ave").
    const kind = token === 'st' && i > 0 && i === tokens.length - 1 ? 'street' : TYPES.get(token);
    if (kind && type === null) type = kind;
    else if (!SMALL.has(token)) name.push(SAME.get(token) ?? token);
  });
  return { type, name };
}

/**
 * The service's street is the file's: every word of its name is in the file's, and both name the
 * same type when both name one ("Rideau Terrace" is not "Rideau Street", "rue Saint-Jean" is
 * "Saint-Jean").
 */
function sameStreet(query: AddressQuery, candidate: AddressCandidate): boolean {
  const asked = streetParts(query.street.replace(/^\s*\d+[a-z]?\b[\s,-]*/i, ''));
  const named = streetParts(candidate.street);
  return (
    named.name.length > 0 &&
    named.name.every((word) => asked.name.includes(word)) &&
    (asked.type === null || named.type === null || asked.type === named.type)
  );
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
 * "rang Double" in another town is not the one. A place estimated along the street from the
 * number is the best guess on the street, never the house itself.
 */
export function placementFor(
  query: AddressQuery,
  candidates: readonly AddressCandidate[],
): Placement | null {
  const number = civicNumber(query.street);
  const fitting = candidates.filter(
    (candidate) => sameStreet(query, candidate) && sameTownOrPostalCode(query, candidate),
  );
  const numbered = (estimated: boolean) =>
    number
      ? fitting.find(
          (candidate) => candidate.number === number && Boolean(candidate.estimated) === estimated,
        )
      : undefined;
  const atAddress = numbered(false);
  const onStreet = numbered(true) ?? fitting.find((candidate) => !candidate.number) ?? fitting[0];
  const chosen = atAddress ?? onStreet;
  if (!chosen) return null;
  return {
    position: { lat: chosen.lat, lng: chosen.lng },
    precision: atAddress ? 'address' : 'street',
  };
}

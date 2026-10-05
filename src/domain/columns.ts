import { fold } from './text.ts';
import type { AppRole, ColumnGroup, ColumnRoles, FieldRole } from './types.ts';

export const APP_ROLES: readonly AppRole[] = [
  'packageStatus',
  'visitDate',
  'callDate',
  'callResult',
  'notes',
];

/** Header matching ignores case, accents, spaces and punctuation: "Code postal" = "CODE_POSTAL". */
export function headerKey(header: string): string {
  return fold(header).replace(/ /g, '');
}

/**
 * Columns Terrain adds to its My Maps update. My Maps keeps them as data columns, so a
 * campaign read from My Maps pins gets them back with its next KMZ: Terrain fills them on export,
 * Edit info leaves them out, and their values coming back unchanged are no Import update.
 */
export const MY_MAPS_COLUMNS = {
  parcelId: 'Parcel ID',
  latitude: 'Latitude',
  longitude: 'Longitude',
  /** The coordinates, or the address My Maps placed a pin from when it has none. */
  location: 'Location',
} as const;

export type MyMapsColumn = keyof typeof MY_MAPS_COLUMNS;

/** Which of Terrain's My Maps columns a column is, in a campaign read from My Maps pins. */
export function myMapsColumnOf(column: string, roles: ColumnRoles): MyMapsColumn | null {
  // In a spreadsheet the parcel ID is a column: every column there is the client's own.
  if (roles.parcelId !== undefined) return null;
  const key = headerKey(column);
  for (const [name, header] of Object.entries(MY_MAPS_COLUMNS))
    if (headerKey(header) === key) return name as MyMapsColumn;
  return null;
}

const ROLE_HEADERS: Readonly<Record<FieldRole, readonly string[]>> = {
  packageStatus: ['packagestatus', 'statutcolis', 'statutdupaquet'],
  visitDate: ['visitdate', 'datevisite', 'datedevisite', 'datedelavisite'],
  callDate: ['calldate', 'dateappel', 'datedappel'],
  callResult: ['callresult', 'resultatappel', 'resultatdelappel'],
  notes: ['notes', 'note', 'remarques', 'commentaires'],
  parcelId: ['row', 'rowno', 'rownum', 'rownumber', 'rowid', 'parcelid', 'parcel'],
  lat: ['latitude', 'lat', 'y'],
  lng: ['longitude', 'lng', 'lon', 'long', 'x'],
  wkt: ['wkt', 'geometry', 'geometrie'],
  street: ['adresse', 'address', 'street', 'rue'],
  town: ['municipalite', 'municipality', 'ville', 'city', 'town'],
  province: ['province', 'prov'],
  postalCode: ['codepostal', 'postalcode', 'cp', 'zip'],
  salutation: ['appel', 'salutation', 'titre'],
  firstName: ['prenom', 'firstname'],
  lastName: ['nom', 'lastname', 'surname'],
  company: ['proprietaire', 'compagnie', 'company', 'owner'],
  homePhone: ['telres', 'residentialphone', 'homephone', 'telephone'],
  cellPhone: ['cellulaire', 'cell', 'cellphone', 'mobile'],
  workPhone: ['telbur', 'workphone'],
  email: ['courriel', 'email'],
};

/** The role of each column Terrain recognizes by its header. */
export function detectRoles(columns: readonly string[]): ColumnRoles {
  const byKey = new Map<string, string>();
  for (const column of columns) {
    const key = headerKey(column);
    if (!byKey.has(key)) byKey.set(key, column);
  }
  const roles: ColumnRoles = {};
  for (const [role, candidates] of Object.entries(ROLE_HEADERS) as [
    FieldRole,
    readonly string[],
  ][]) {
    for (const candidate of candidates) {
      const column = byKey.get(candidate);
      if (column !== undefined) {
        roles[role] = column;
        break;
      }
    }
  }
  return roles;
}

// Alex's rule of 2026-10-01: a fix goes on one owner only (changing one co-owner's number must not
// change the other's). The address and phone columns are person fields; only the parcel's own
// columns are shared by its owners.
const PARCEL_COLUMNS = new Set(['anclot', 'numlot', 'rowlocation']);

/** Default Edit info grouping: parcel columns per parcel, every other column per owner; app-owned columns left out. */
export function defaultColumnGroups(
  columns: readonly string[],
  roles: ColumnRoles,
): Record<string, ColumnGroup> {
  const appColumns = new Set(APP_ROLES.map((role) => roles[role]).filter(Boolean));
  const groups: Record<string, ColumnGroup> = {};
  for (const column of columns) {
    if (appColumns.has(column)) continue;
    groups[column] = PARCEL_COLUMNS.has(headerKey(column)) ? 'parcel' : 'person';
  }
  return groups;
}

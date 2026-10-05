import { addressParts, sameAddress, type AddressParts } from './address.ts';
import type { MyMapsColumn } from './columns.ts';
import { lotKeysOf } from './parcel.ts';
import { compactKey, fold } from './text.ts';
import type { ColumnRoles, FieldRole, LatLng, Row } from './types.ts';

/** The correction if there is one, otherwise the imported value. */
export function currentValue(
  row: Pick<Row, 'sourceFields' | 'edits'>,
  column: string | undefined,
): string {
  if (column === undefined) return '';
  return row.edits[column] ?? row.sourceFields[column] ?? '';
}

/** Where a row is, for My Maps: its coordinates, else the address My Maps placed it from. */
export function locationOf(
  row: Pick<Row, 'position' | 'addressText' | 'sourceFields' | 'edits'>,
  roles: ColumnRoles,
): string {
  if (row.position) return `${String(row.position.lat)}, ${String(row.position.lng)}`;
  if (row.addressText) return row.addressText;
  return [roles.street, roles.town, roles.province, roles.postalCode]
    .map((column) => currentValue(row, column).split(/\r?\n/)[0]?.trim() ?? '')
    .filter(Boolean)
    .join(', ');
}

/** What Terrain writes in one of its My Maps columns for a row. */
export function myMapsValue(row: Row, column: MyMapsColumn, roles: ColumnRoles): string {
  switch (column) {
    case 'parcelId':
      return row.parcelIdRaw;
    case 'latitude':
      return row.position ? String(row.position.lat) : '';
    case 'longitude':
      return row.position ? String(row.position.lng) : '';
    case 'location':
      return locationOf(row, roles);
  }
}

export type FieldReader = (role: FieldRole) => string;

export function readerFor(
  fields: Readonly<Record<string, string>>,
  roles: ColumnRoles,
): FieldReader {
  return (role) => {
    const column = roles[role];
    return column === undefined ? '' : (fields[column] ?? '');
  };
}

export function currentReader(
  row: Pick<Row, 'sourceFields' | 'edits'>,
  roles: ColumnRoles,
): FieldReader {
  return (role) => currentValue(row, roles[role]);
}

/** PRENOM NOM, else the company in Propriétaire, else APPEL. */
export function displayName(read: FieldReader): string {
  const person = `${read('firstName')} ${read('lastName')}`.replace(/\s+/g, ' ').trim();
  return person || read('company').trim() || read('salutation').trim();
}

/** Matches rows across re-imports; built from imported values only, never corrections. */
export function fingerprintOf(parcelIdRaw: string, imported: FieldReader): string {
  return [compactKey(parcelIdRaw), fold(displayName(imported)), fold(imported('street'))].join('|');
}

export function lotKeysForRow(
  row: Pick<Row, 'parcelIdRaw' | 'oldParcelIds' | 'sourceFields' | 'edits'>,
  lotColumn: string | null,
): string[] {
  return lotColumn === null
    ? lotKeysOf(row.parcelIdRaw, row.oldParcelIds)
    : lotKeysOf(currentValue(row, lotColumn));
}

/** The same coordinates, to a centimeter. */
export function samePosition(a: LatLng | null, b: LatLng | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
}

export function metersBetween(a: LatLng, b: LatLng): number {
  const north = (b.lat - a.lat) * 111_320;
  const east = (b.lng - a.lng) * 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(north, east);
}

export interface IdentityInput {
  rowId: string;
  rowIndex: number;
  position: LatLng | null;
  address: AddressParts;
  lotKeys: readonly string[];
}

export interface House {
  houseKey: string;
  /** In file order. */
  rowIds: string[];
  /** Null until a row of the house has a position ("No position yet"). */
  position: LatLng | null;
}

const SAME_SPOT_METERS = 5;
const CELL_DEGREES = 0.00005;

function cellOf(position: LatLng): [number, number] {
  const east = position.lng * Math.cos((position.lat * Math.PI) / 180);
  return [Math.floor(position.lat / CELL_DEGREES), Math.floor(east / CELL_DEGREES)];
}

/** Pairs of items whose positions are within `meters`, using a grid so it stays fast on 2,000 rows. */
function nearbyPairs<T>(
  items: readonly T[],
  positionOf: (item: T) => LatLng | null,
  meters: number,
): [T, T][] {
  const grid = new Map<string, T[]>();
  const pairs: [T, T][] = [];
  for (const item of items) {
    const position = positionOf(item);
    if (!position) continue;
    const [y, x] = cellOf(position);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const other of grid.get(`${String(y + dy)}:${String(x + dx)}`) ?? []) {
          const otherPosition = positionOf(other);
          if (otherPosition && metersBetween(position, otherPosition) <= meters)
            pairs.push([other, item]);
        }
      }
    }
    const key = `${String(y)}:${String(x)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(item);
    else grid.set(key, [item]);
  }
  return pairs;
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly rank: ReadonlyMap<string, number>;

  constructor(ids: readonly string[], order: ReadonlyMap<string, number>) {
    for (const id of ids) this.parent.set(id, id);
    this.rank = order;
  }

  find(id: string): string {
    let root = id;
    for (let up = this.parent.get(root) ?? root; up !== root; up = this.parent.get(root) ?? root)
      root = up;
    let node = id;
    while (node !== root) {
      const up = this.parent.get(node) ?? root;
      this.parent.set(node, root);
      node = up;
    }
    return root;
  }

  /** The earlier row stays the root, so a house keeps the key of its first row. */
  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    if ((this.rank.get(rootA) ?? 0) <= (this.rank.get(rootB) ?? 0)) this.parent.set(rootB, rootA);
    else this.parent.set(rootA, rootB);
  }
}

/** The position shared by most rows (within 5 m counts as one); ties go to the first row in file order. */
function housePosition(
  members: readonly Pick<IdentityInput, 'position' | 'rowIndex'>[],
): LatLng | null {
  let best: { position: LatLng; count: number; index: number } | null = null;
  for (const candidate of members) {
    if (!candidate.position) continue;
    const here = candidate.position;
    const count = members.filter(
      (other) => other.position && metersBetween(here, other.position) <= SAME_SPOT_METERS,
    ).length;
    if (!best || count > best.count || (count === best.count && candidate.rowIndex < best.index)) {
      best = { position: here, count, index: candidate.rowIndex };
    }
  }
  return best?.position ?? null;
}

/**
 * Houses (with Alex's address rule): rows are one house when their addresses match
 * (see sameAddress), or when they sit within 5 m of each other and share a lot. Transitive.
 */
export function groupHouses(rows: readonly IdentityInput[]): House[] {
  const ordered = [...rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const order = new Map(ordered.map((row, i) => [row.rowId, i]));
  const sets = new UnionFind(
    ordered.map((row) => row.rowId),
    order,
  );

  const byStreet = new Map<string, IdentityInput[]>();
  for (const row of ordered) {
    if (!row.address.street) continue;
    const bucket = byStreet.get(row.address.street);
    if (bucket) bucket.push(row);
    else byStreet.set(row.address.street, [row]);
  }
  for (const bucket of byStreet.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        if (a && b && sameAddress(a.address, b.address)) sets.union(a.rowId, b.rowId);
      }
    }
  }

  for (const [a, b] of nearbyPairs(ordered, (row) => row.position, SAME_SPOT_METERS)) {
    if (a.lotKeys.some((key) => b.lotKeys.includes(key))) sets.union(a.rowId, b.rowId);
  }

  const members = new Map<string, IdentityInput[]>();
  for (const row of ordered) {
    const root = sets.find(row.rowId);
    const list = members.get(root);
    if (list) list.push(row);
    else members.set(root, [row]);
  }
  return [...members.entries()].map(([root, list]) => ({
    houseKey: `h:${root}`,
    rowIds: list.map((row) => row.rowId),
    position: housePosition(list),
  }));
}

export function identityInputs(rows: readonly Row[], roles: ColumnRoles): IdentityInput[] {
  return rows.map((row) => ({
    rowId: row.rowId,
    rowIndex: row.rowIndex,
    position: row.position,
    address: addressParts(currentReader(row, roles)),
    lotKeys: row.lotKeys,
  }));
}

/** The houses of rows whose house keys are set, in file order, each at the position most of its rows share. */
export function housesOfRows(
  rows: readonly Pick<Row, 'rowId' | 'rowIndex' | 'houseKey' | 'position'>[],
): House[] {
  const members = new Map<string, Pick<Row, 'rowId' | 'rowIndex' | 'position'>[]>();
  for (const row of [...rows].sort((a, b) => a.rowIndex - b.rowIndex)) {
    const list = members.get(row.houseKey);
    if (list) list.push(row);
    else members.set(row.houseKey, [row]);
  }
  return [...members.entries()].map(([houseKey, list]) => ({
    houseKey,
    rowIds: list.map((row) => row.rowId),
    position: housePosition(list),
  }));
}

/**
 * Houses by spot: houses within 5 m of each other share one pin on the map, usually a
 * geocoding fallback such as a village center. Houses with no position are left out.
 */
export function spotsOf(houses: readonly House[]): House[][] {
  const placed = houses.filter((house) => house.position);
  const order = new Map(placed.map((house, i) => [house.houseKey, i]));
  const sets = new UnionFind(
    placed.map((house) => house.houseKey),
    order,
  );
  for (const [a, b] of nearbyPairs(placed, (house) => house.position, SAME_SPOT_METERS)) {
    sets.union(a.houseKey, b.houseKey);
  }
  const groups = new Map<string, House[]>();
  for (const house of placed) {
    const root = sets.find(house.houseKey);
    const group = groups.get(root);
    if (group) group.push(house);
    else groups.set(root, [house]);
  }
  return [...groups.values()];
}

/** Groups of different houses at one spot (a geocoding fallback such as a village center). */
export function sharedPoints(houses: readonly House[]): House[][] {
  return spotsOf(houses).filter((group) => group.length > 1);
}

/** Houses whose rows sit more than `meters` apart: usually pins Alex pulled apart by hand. */
export function spreadHouses(
  houses: readonly House[],
  positionOf: ReadonlyMap<string, LatLng | null>,
  meters = 50,
): House[] {
  return houses.filter((house) => {
    const positions = house.rowIds
      .map((id) => positionOf.get(id))
      .filter((p): p is LatLng => Boolean(p));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        if (a && b && metersBetween(a, b) > meters) return true;
      }
    }
    return false;
  });
}

/** Lots whose rows live at more than one house: co-owners at other addresses. */
export function lotsAcrossHouses(rows: readonly Row[]): { lotKey: string; houseKeys: string[] }[] {
  const housesByLot = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const key of row.lotKeys) {
      const set = housesByLot.get(key);
      if (set) set.add(row.houseKey);
      else housesByLot.set(key, new Set([row.houseKey]));
    }
  }
  return [...housesByLot.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([lotKey, set]) => ({ lotKey, houseKeys: [...set] }));
}

import { housesOfRows, spotsOf, type House } from './identity.ts';
import { startStatus } from './statuses.ts';
import type { Campaign, LatLng, Row, Status } from './types.ts';

/** One pin on the map: one house, or the houses sharing a spot. */
export interface Pin {
  /** The first house's key. */
  id: string;
  houseKeys: string[];
  position: LatLng;
  /** The badge: the rows of a house, or the houses at a spot. */
  count: number;
  color: string;
  /** Every row closed from its lot: drawn as a ring with a white center. */
  ring: boolean;
}

const changedAt = (row: Row) => Date.parse(row.updatedAt) || 0;

/**
 * The status a house shows: its rows' status when they all agree; otherwise To visit when any
 * row is; otherwise the status of the row changed last (the first in file order on a tie).
 */
export function houseStatus(rows: readonly Row[], statuses: readonly Status[]): Status {
  const start = startStatus(statuses);
  const byId = (id: string) => statuses.find((status) => status.id === id) ?? start;
  const [first] = rows;
  if (!first) return start;
  if (rows.every((row) => row.statusId === first.statusId)) return byId(first.statusId);
  if (rows.some((row) => row.statusId === start.id)) return start;
  let latest = first;
  for (const row of rows) if (changedAt(row) > changedAt(latest)) latest = row;
  return byId(latest.statusId);
}

/** Rows per status, for the filter chips (chip counts are rows). */
export function statusCounts(rows: readonly Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.statusId, (counts.get(row.statusId) ?? 0) + 1);
  return counts;
}

export interface MapContent {
  pins: Pin[];
  /** Houses with no position yet: they wait in a list until pinned at the door. */
  unplaced: House[];
}

/**
 * The map's pins: one per house, houses within 5 m of each other sharing one. A status filter
 * keeps the houses holding at least one row with that status.
 */
export function mapContent(
  rows: readonly Row[],
  statuses: readonly Status[],
  filterStatusId: string | null = null,
): MapContent {
  const rowsByHouse = new Map<string, Row[]>();
  for (const row of rows) {
    const list = rowsByHouse.get(row.houseKey);
    if (list) list.push(row);
    else rowsByHouse.set(row.houseKey, [row]);
  }
  const houses = housesOfRows(rows).filter(
    (house) =>
      filterStatusId === null ||
      (rowsByHouse.get(house.houseKey) ?? []).some((row) => row.statusId === filterStatusId),
  );
  const pins = spotsOf(houses).flatMap((spot): Pin[] => {
    const [first] = spot;
    if (!first?.position) return [];
    const spotRows = spot.flatMap((house) => rowsByHouse.get(house.houseKey) ?? []);
    return [
      {
        id: first.houseKey,
        houseKeys: spot.map((house) => house.houseKey),
        position: first.position,
        count: spot.length > 1 ? spot.length : spotRows.length,
        color: houseStatus(spotRows, statuses).color,
        ring: spotRows.length > 0 && spotRows.every((row) => row.origin !== null),
      },
    ];
  });
  return { pins, unplaced: houses.filter((house) => !house.position) };
}

/** Other houses holding rows of this house's lots. */
export function lotNeighbors(rows: readonly Row[], houseKey: string): string[] {
  const keys = new Set(
    rows.filter((row) => row.houseKey === houseKey).flatMap((row) => row.lotKeys),
  );
  const neighbors = new Set<string>();
  for (const row of rows) {
    if (row.houseKey !== houseKey && row.lotKeys.some((key) => keys.has(key)))
      neighbors.add(row.houseKey);
  }
  return [...neighbors];
}

/**
 * "Copy campaign area": the campaign's bounding box padded by 2 km, as the basemap script
 * takes it: west,south,east,north.
 */
export function campaignArea(bounds: Campaign['bounds'], padMeters = 2000): string | null {
  if (!bounds) return null;
  const [west, south, east, north] = bounds;
  const padLat = padMeters / 111_320;
  const padLng = padMeters / (111_320 * Math.cos((((south + north) / 2) * Math.PI) / 180));
  return [west - padLng, south - padLat, east + padLng, north + padLat]
    .map((value) => value.toFixed(5))
    .join(',');
}

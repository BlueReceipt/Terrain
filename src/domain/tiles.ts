import type { LatLng } from './types.ts';

/** One square of the online map (web mercator tile numbers), as the relay serves it: /tiles/z/x/y. */
export interface TileKey {
  z: number;
  x: number;
  y: number;
}

/**
 * How much map a campaign keeps for no signal: around every house, the streets close up (zoom 14,
 * which the map also draws closer views from), then wider and less detailed the farther out.
 */
const AROUND_HOUSES: readonly { z: number; meters: number }[] = [
  { z: 5, meters: 256_000 },
  { z: 6, meters: 128_000 },
  { z: 7, meters: 64_000 },
  { z: 8, meters: 32_000 },
  { z: 9, meters: 16_000 },
  { z: 10, meters: 8_000 },
  { z: 11, meters: 4_000 },
  { z: 12, meters: 2_000 },
  { z: 13, meters: 1_000 },
  { z: 14, meters: 500 },
];

/** At most this many tiles (about 60 MB at the most); past it, the farthest houses keep less detail. */
export const MAX_TILES = 3000;

const METERS_PER_DEGREE = 111_320;

/** The tile holding a position at a zoom. */
export function tileOf(position: LatLng, z: number): TileKey {
  const n = 2 ** z;
  const lat = Math.max(-85.0511, Math.min(85.0511, position.lat));
  const rad = (lat * Math.PI) / 180;
  const x = Math.floor(((position.lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/**
 * The tiles a campaign needs to show its map with no signal, around each house, coarse levels
 * first; each tile once, and no more than MAX_TILES.
 */
export function tilesAround(positions: readonly LatLng[]): TileKey[] {
  const tiles = new Map<string, TileKey>();
  for (const { z, meters } of AROUND_HOUSES) {
    for (const position of positions) {
      const dLat = meters / METERS_PER_DEGREE;
      const dLng = meters / (METERS_PER_DEGREE * Math.cos((position.lat * Math.PI) / 180));
      const northWest = tileOf({ lat: position.lat + dLat, lng: position.lng - dLng }, z);
      const southEast = tileOf({ lat: position.lat - dLat, lng: position.lng + dLng }, z);
      for (let x = northWest.x; x <= southEast.x; x++) {
        for (let y = northWest.y; y <= southEast.y; y++) {
          const key = `${String(z)}/${String(x)}/${String(y)}`;
          if (tiles.has(key)) continue;
          if (tiles.size >= MAX_TILES) return [...tiles.values()];
          tiles.set(key, { z, x, y });
        }
      }
    }
  }
  return [...tiles.values()];
}

/** The relay's address of a tile, on Terrain's own address. */
export function tilePath({ z, x, y }: TileKey): string {
  return `/tiles/${String(z)}/${String(x)}/${String(y)}.pbf`;
}

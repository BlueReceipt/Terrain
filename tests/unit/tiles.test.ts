import { describe, expect, it } from 'vitest';
import { MAX_TILES, tileOf, tilePath, tilesAround } from '../../src/domain/tiles.ts';

// The poutine sample's Snack-bar St-Jean, in Québec City.
const SNACK = { lat: 46.8113, lng: -71.2176 };

describe('the map kept for no signal', () => {
  it('finds the tile of a position as the map numbers them', () => {
    expect(tileOf(SNACK, 14)).toEqual({ z: 14, x: 4950, y: 5775 });
    expect(tileOf(SNACK, 0)).toEqual({ z: 0, x: 0, y: 0 });
    expect(tilePath({ z: 14, x: 4950, y: 5775 })).toBe('/tiles/14/4950/5775.pbf');
  });

  it('keeps every house’s streets close up, then wider and coarser around them', () => {
    const tiles = tilesAround([SNACK]);
    const levels = new Map<number, number>();
    for (const tile of tiles) levels.set(tile.z, (levels.get(tile.z) ?? 0) + 1);
    expect([...levels.keys()]).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(tiles).toContainEqual(tileOf(SNACK, 14));
    // Half a kilometre around the house at zoom 14: one to four tiles.
    expect(levels.get(14)).toBeGreaterThanOrEqual(1);
    expect(levels.get(14)).toBeLessThanOrEqual(4);
    expect(tiles.length).toBeLessThan(45);
  });

  it('keeps each tile once for neighbours, and never more than its cap', () => {
    const street = Array.from({ length: 50 }, (_, i) => ({
      lat: SNACK.lat,
      lng: SNACK.lng + i * 1e-4,
    }));
    expect(tilesAround(street).length).toBe(tilesAround([SNACK, street[49] ?? SNACK]).length);
    const province = Array.from({ length: 4000 }, (_, i) => ({
      lat: 45 + (i % 80) * 0.05,
      lng: -79 + Math.floor(i / 80) * 0.25,
    }));
    const capped = tilesAround(province);
    expect(capped).toHaveLength(MAX_TILES);
    // The overview comes first: every coarse level is kept whole.
    expect(capped.some((tile) => tile.z === 5)).toBe(true);
  });
});

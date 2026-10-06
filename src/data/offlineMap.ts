import { tilePath, type TileKey } from '../domain/tiles.ts';

/** Where the service worker keeps the online map's tiles (src/sw.ts). */
export const TILE_CACHE = 'terrain-tiles';

/** Tiles fetched at once: a background chore, not a rush. */
const AT_ONCE = 4;

/**
 * Keeps these tiles on the phone, so the map shows them with no signal: the ones it has are
 * skipped, the others fetched from the relay and kept. Stops when `stopped` says so, or the
 * connection drops; `progress` hears how many of them the phone has.
 */
export async function saveTiles(
  tiles: readonly TileKey[],
  progress: (kept: number) => void,
  stopped: () => boolean,
): Promise<void> {
  const cache = await caches.open(TILE_CACHE);
  let kept = 0;
  const missing: string[] = [];
  for (const tile of tiles) {
    const path = tilePath(tile);
    if (await cache.match(path)) kept += 1;
    else missing.push(path);
  }
  progress(kept);
  for (let start = 0; start < missing.length && !stopped(); start += AT_ONCE) {
    await Promise.all(
      missing.slice(start, start + AT_ONCE).map(async (path) => {
        const answer = await fetch(path);
        if (answer.status !== 200 && answer.status !== 204) throw new Error(String(answer.status));
        // The service worker keeps what passes through it; without one yet, keep it here.
        if (!(await cache.match(path))) await cache.put(path, answer);
        kept += 1;
      }),
    );
    progress(kept);
  }
}

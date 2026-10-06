import { signal } from '@preact/signals';
import { saveTiles } from '../data/offlineMap.ts';
import { housesOfRows } from '../domain/identity.ts';
import { tilesAround } from '../domain/tiles.ts';
import { isPublicDemo } from './demo.ts';
import { basemap, current, settings } from './flow.ts';
import { hasRelay } from './online.ts';

/** The open campaign's map kept for no signal: how many of its tiles the phone has. */
export const keptMap = signal<{ kept: number; total: number; saving: boolean } | null>(null);

let running = false;

/**
 * Keeps the open campaign's map on the phone, in the background while there's a connection
 * (Alex, 2026-10-05: "automatically loads a map"): where Terrain has a relay and the online map is
 * on, but not on the public demo, whose visitors keep only what they look at, nor when an offline
 * map file is loaded. Only the map area goes online, as for the online map itself.
 */
export async function keepCampaignMap(): Promise<void> {
  const loaded = current.value;
  if (
    !loaded ||
    running ||
    !hasRelay(location.hostname) ||
    isPublicDemo(location.hostname) ||
    settings.value?.onlineMap === false ||
    basemap.value ||
    !navigator.onLine ||
    !('caches' in window)
  )
    return;
  const positions = housesOfRows(loaded.rows).flatMap((house) =>
    house.position ? [house.position] : [],
  );
  const tiles = tilesAround(positions);
  if (tiles.length === 0) return;
  const campaignId = loaded.campaign.id;
  running = true;
  let kept = 0;
  keptMap.value = { kept, total: tiles.length, saving: true };
  try {
    await saveTiles(
      tiles,
      (count) => {
        kept = count;
        keptMap.value = { kept, total: tiles.length, saving: true };
      },
      () =>
        current.value?.campaign.id !== campaignId ||
        settings.value?.onlineMap === false ||
        !navigator.onLine,
    );
  } catch {
    // The connection dropped or the relay didn't answer: the rest comes with the next connection.
  } finally {
    running = false;
    keptMap.value = { kept, total: tiles.length, saving: false };
  }
}

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (PrecacheEntry | string)[];
};

// The whole app shell is precached at install, so every later load works with no network.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// A map label in characters Terrain's font doesn't have asks for a glyph range it doesn't ship:
// answer with an empty range instead of going to the network (those characters just don't show).
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin && url.pathname.startsWith('/map-assets/glyphs/'),
  () =>
    Promise.resolve(
      new Response(new Uint8Array(0), { headers: { 'Content-Type': 'application/x-protobuf' } }),
    ),
);

// The online map's tiles (the relay's /tiles/, src/ui/online.ts): every tile Terrain gets is kept,
// so the map it has seen or saved (src/data/offlineMap.ts) shows with no signal. The oldest go when
// there are too many; an answer that isn't a tile is never kept.
const TILES = 'terrain-tiles';
const MAX_KEPT_TILES = 8000;
let putsSinceTrim = 0;

async function trimTiles(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_KEPT_TILES)))
    await cache.delete(key);
}

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/tiles/'),
  async ({ request }) => {
    const cache = await caches.open(TILES);
    const kept = await cache.match(request);
    if (kept) return kept;
    const fetched = await fetch(request);
    if (fetched.status === 200 || fetched.status === 204) {
      await cache.put(request, fetched.clone());
      if (++putsSinceTrim >= 200) {
        putsSinceTrim = 0;
        await trimTiles(cache);
      }
    }
    return fetched;
  },
);

// Prompt mode: a new version waits until the app asks it to take over.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

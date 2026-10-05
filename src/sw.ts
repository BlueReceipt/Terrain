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

// Prompt mode: a new version waits until the app asks it to take over.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

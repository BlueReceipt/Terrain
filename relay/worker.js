// Terrain's demo relay: a Cloudflare Worker on two routes of the public demo's address (README, "The
// demo's relay"). The demo only ever talks to its own address, and this Worker fetches for it:
// - /mymaps/<id>: one My Maps map's KMZ export from Google, only for a map shared with "Anyone with
//   the link". Google doesn't let other sites read the export themselves.
// - /tiles/<z>/<x>/<y>.pbf: the background map's tiles from OpenFreeMap (OpenStreetMap data), so the
//   demo shows streets while it's online. Offline, the map stays plain under the pins.
// Nothing is logged or stored. It needs no packages and no settings; relay/wrangler.jsonc publishes it.

const MAP_ID = /^[\w-]{10,128}$/;
const MAX_BYTES = 20 * 1024 * 1024;

const OPENFREEMAP = 'https://tiles.openfreemap.org/planet';
const TILE = /^\/tiles\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.pbf$/;
// OpenFreeMap's tiles stop at zoom 14; the map draws closer views from those.
const MAX_ZOOM = 14;

// Every answer is data, never a page: opened in a browser it downloads, and it can't run anything.
const LOCKED = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

/**
 * @param {number} status
 * @param {string} error
 */
function problem(status, error) {
  return Response.json({ error }, { status, headers: { ...LOCKED, 'Cache-Control': 'no-store' } });
}

/** @param {Uint8Array} bytes */
function looksLikeKmz(bytes) {
  // A KMZ is a zip file. Anything else (Google's sign-in page) means the map isn't shared.
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** @param {Uint8Array} bytes */
function looksLikeKml(bytes) {
  return new TextDecoder().decode(bytes.subarray(0, 2048)).includes('<kml');
}

/** @param {string} id */
async function myMapsExport(id) {
  let google;
  try {
    // A map that isn't shared redirects to Google's sign-in page, caught below.
    google = await fetch(`https://www.google.com/maps/d/kml?mid=${id}`);
  } catch {
    return problem(502, 'unreachable');
  }
  if (google.status === 404) return problem(404, 'not-found');
  if (!google.ok) return problem(403, 'not-shared');
  const declared = Number(google.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BYTES) return problem(413, 'too-big');

  const bytes = new Uint8Array(await google.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return problem(413, 'too-big');
  const kmz = looksLikeKmz(bytes);
  if (!kmz && !looksLikeKml(bytes)) return problem(403, 'not-shared');

  // Google names the file after the map, and Terrain names the campaign after it.
  const given = google.headers.get('Content-Disposition');
  return new Response(bytes, {
    headers: {
      ...LOCKED,
      'Cache-Control': 'no-store',
      'Content-Type': kmz
        ? 'application/vnd.google-earth.kmz'
        : 'application/vnd.google-earth.kml+xml',
      'Content-Disposition': given
        ? given.replace(/^\s*inline/i, 'attachment')
        : `attachment; filename="My Maps map.${kmz ? 'kmz' : 'kml'}"`,
    },
  });
}

/**
 * The tile at z/x/y, when the path names one that exists.
 * @param {string} pathname
 */
function tileAt(pathname) {
  const match = TILE.exec(pathname);
  if (!match) return null;
  const [z, x, y] = match.slice(1).map(Number);
  if (z === undefined || x === undefined || y === undefined || z > MAX_ZOOM) return null;
  return x < 2 ** z && y < 2 ** z ? { z, x, y } : null;
}

/**
 * Cloudflare keeps what OpenFreeMap sends for this many seconds, so each tile is fetched once.
 * @param {number} seconds
 */
const kept = (seconds) =>
  /** @type {RequestInit} */ ({ cf: { cacheTtl: seconds, cacheEverything: true } });

/** @param {{ z: number, x: number, y: number }} at */
async function tile({ z, x, y }) {
  let answer;
  try {
    // The tiles' address changes with each weekly build of OpenFreeMap's map: its index says it.
    const index = /** @type {{ tiles?: unknown[] }} */ (
      await (await fetch(OPENFREEMAP, kept(3600))).json()
    );
    const template = index.tiles?.[0];
    if (typeof template !== 'string' || !template.startsWith('https://tiles.openfreemap.org/'))
      return problem(502, 'unreachable');
    const address = template
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    answer = await fetch(address, kept(30 * 24 * 3600));
  } catch {
    return problem(502, 'unreachable');
  }
  const headers = { ...LOCKED, 'Cache-Control': 'public, max-age=86400' };
  // No tile there (open sea): an empty tile, which the map draws as nothing.
  if (answer.status === 204 || answer.status === 404)
    return new Response(null, { status: 204, headers });
  if (!answer.ok) return problem(502, 'unreachable');
  // A vector tile, under the type Cloudflare compresses on the way to the phone (it leaves
  // application/vnd.mapbox-vector-tile as is): about 40% less to download.
  return new Response(answer.body, {
    headers: { ...headers, 'Content-Type': 'application/x-protobuf' },
  });
}

export default {
  /** @param {Request} request */
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET') {
      const id = /^\/mymaps\/([^/]+)$/.exec(pathname)?.[1];
      if (id && MAP_ID.test(id)) return myMapsExport(id);
      const at = tileAt(pathname);
      if (at) return tile(at);
    }
    return problem(400, pathname.startsWith('/tiles/') ? 'not-a-tile' : 'not-a-map');
  },
};

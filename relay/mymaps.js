// Terrain's My Maps relay: a Cloudflare Worker on the public demo's route terrain.ederer.digital/mymaps*
// (README, "The demo's My Maps relay"). Google doesn't let other sites read a My Maps export, so the
// demo asks its own address and this Worker fetches the map from Google: only Google's KMZ export of
// one map, only for a map shared with "Anyone with the link", nothing logged or stored. Paste this
// file into the Worker as is: it needs no packages and no settings.

const MAP_ID = /^[\w-]{10,128}$/;
const MAX_BYTES = 20 * 1024 * 1024;

// Every answer is data, never a page: opened in a browser it downloads, and it can't run anything.
const LOCKED = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

/**
 * @param {number} status
 * @param {string} error
 */
function problem(status, error) {
  return Response.json({ error }, { status, headers: LOCKED });
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

export default {
  /** @param {Request} request */
  async fetch(request) {
    const id = /^\/mymaps\/([^/]+)$/.exec(new URL(request.url).pathname)?.[1];
    if (request.method !== 'GET' || !id || !MAP_ID.test(id)) return problem(400, 'not-a-map');

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
        'Content-Type': kmz
          ? 'application/vnd.google-earth.kmz'
          : 'application/vnd.google-earth.kml+xml',
        'Content-Disposition': given
          ? given.replace(/^\s*inline/i, 'attachment')
          : `attachment; filename="My Maps map.${kmz ? 'kmz' : 'kml'}"`,
      },
    });
  },
};

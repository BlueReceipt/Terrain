// Terrain's relay: a Cloudflare Worker on routes of Terrain's own addresses (README, "The relay").
// Terrain only ever talks to its own address, and this Worker fetches for it:
// - /mymaps/<id> (the public demo only): one My Maps map's KMZ export from Google, only for a map
//   shared with "Anyone with the link". Google doesn't let other sites read the export themselves.
// - /tiles/<z>/<x>/<y>.pbf: the background map's tiles from OpenFreeMap (OpenStreetMap data), so
//   the map shows streets while it's online. Offline, the map stays plain under the pins.
// - /geocode: where houses are, from Adresses Québec (Gouvernement du Québec), for files without
//   coordinates. It takes a house's street, town, postal code and province, and refuses anything
//   else: no name, phone number, parcel ID or note ever passes through here.
// Nothing is logged or stored. It needs no packages and no settings; relay/wrangler.jsonc publishes it.

const MAP_ID = /^[\w-]{10,128}$/;
const MAX_BYTES = 20 * 1024 * 1024;

const OPENFREEMAP = 'https://tiles.openfreemap.org/planet';
const TILE = /^\/tiles\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.pbf$/;
// OpenFreeMap's tiles stop at zoom 14; the map draws closer views from those.
const MAX_ZOOM = 14;

const ADRESSES_QUEBEC =
  'https://servicescarto.mrnf.gouv.qc.ca/pes/rest/services/Territoire/Adresse_Geocodage/GeocodeServer/findAddressCandidates';
/** All a lookup may carry: the house's address. */
const ADDRESS_FIELDS = ['street', 'town', 'postalCode', 'province'];
const MAX_ADDRESSES = 25;
const MAX_FIELD = 200;
// A few addresses at a time: the government's service, not a crowd.
const AT_ONCE = 5;

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

/**
 * @typedef {{ street: string, town: string, postalCode: string, province: string }} Address
 * @typedef {{ lat: number, lng: number, number: string, street: string, town: string, postalCode: string }} Candidate
 */

/**
 * The address in a lookup, or null when it holds anything but the address fields, as text.
 * @param {unknown} value
 * @returns {Address | null}
 */
function addressIn(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = /** @type {Record<string, unknown>} */ (value);
  if (Object.keys(fields).some((key) => !ADDRESS_FIELDS.includes(key))) return null;
  /** @type {Record<string, string>} */
  const address = {};
  for (const key of ADDRESS_FIELDS) {
    const text = fields[key] ?? '';
    if (typeof text !== 'string' || text.length > MAX_FIELD) return null;
    address[key] = text.trim();
  }
  const { street = '', town = '', postalCode = '', province = '' } = address;
  return street && town ? { street, town, postalCode, province } : null;
}

/**
 * Adresses Québec's answers for one address: houses at a civic number, and streets.
 * @param {Address} address
 * @returns {Promise<Candidate[]>}
 */
async function candidatesFor(address) {
  const area = [address.province, address.postalCode].filter(Boolean).join(' ');
  const query = new URLSearchParams({
    SingleLine: [address.street, address.town, area].filter(Boolean).join(', '),
    outSR: '4326',
    maxLocations: '5',
    outFields: 'Num,Odonyme,City,ZIP',
    f: 'json',
  });
  const answer = await fetch(`${ADRESSES_QUEBEC}?${query.toString()}`);
  if (!answer.ok) throw new Error('unreachable');
  const found =
    /** @type {{ candidates?: { address?: string, location?: { x: number, y: number }, attributes?: Record<string, unknown> }[] }} */ (
      await answer.json()
    );
  if (!Array.isArray(found.candidates)) throw new Error('unreachable');
  return found.candidates.flatMap(({ address: label = '', location, attributes = {} }) => {
    if (!location) return [];
    // A street's answer names it only in its label: "Rue Saint-Jean, Québec".
    const [named = '', place = ''] = label.split(',').map((part) => part.trim());
    const text = (/** @type {unknown} */ value) =>
      typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    const number = text(attributes.Num);
    return [
      {
        lat: location.y,
        lng: location.x,
        number,
        street: text(attributes.Odonyme) || named.replace(/^\d+\s+/, ''),
        town: text(attributes.City) || place.replace(/\s+[A-Z]\d[A-Z]\d[A-Z]\d$/i, ''),
        postalCode: text(attributes.ZIP),
      },
    ];
  });
}

/** @param {Request} request */
async function geocode(request) {
  if (Number(request.headers.get('Content-Length') ?? '0') > 64 * 1024)
    return problem(413, 'too-many');
  let body;
  try {
    body = /** @type {unknown} */ (await request.json());
  } catch {
    return problem(400, 'not-addresses');
  }
  const list =
    body && typeof body === 'object' && Object.keys(body).join() === 'addresses'
      ? /** @type {{ addresses: unknown }} */ (body).addresses
      : null;
  if (!Array.isArray(list) || list.length === 0) return problem(400, 'not-addresses');
  if (list.length > MAX_ADDRESSES) return problem(413, 'too-many');
  const addresses = list.map(addressIn);
  if (addresses.some((address) => address === null)) return problem(400, 'not-addresses');
  /** @type {Candidate[][]} */
  const results = [];
  try {
    for (let start = 0; start < addresses.length; start += AT_ONCE) {
      const group = /** @type {Address[]} */ (addresses.slice(start, start + AT_ONCE));
      results.push(...(await Promise.all(group.map(candidatesFor))));
    }
  } catch {
    return problem(502, 'unreachable');
  }
  return Response.json({ results }, { headers: { ...LOCKED, 'Cache-Control': 'no-store' } });
}

export default {
  /** @param {Request} request */
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/geocode')
      return request.method === 'POST' ? geocode(request) : problem(400, 'not-addresses');
    if (request.method === 'GET') {
      const id = /^\/mymaps\/([^/]+)$/.exec(pathname)?.[1];
      if (id && MAP_ID.test(id)) return myMapsExport(id);
      const at = tileAt(pathname);
      if (at) return tile(at);
    }
    return problem(400, pathname.startsWith('/tiles/') ? 'not-a-tile' : 'not-a-map');
  },
};

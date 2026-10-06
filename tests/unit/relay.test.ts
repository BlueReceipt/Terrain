import { afterEach, describe, expect, it, vi } from 'vitest';
import relay from '../../relay/worker.js';
import { readFixture } from '../support/import.ts';

const ID = '1PoutineSampleMapIdForTests_0123456';
const KMZ: Uint8Array<ArrayBuffer> = new Uint8Array(
  readFixture('public/poutine-autour-du-quebec.kmz'),
);

/** Google, as the relay sees it: one canned answer, and the address it was asked. */
function google(answer: Response | Error): { asked: () => string[] } {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
    );
  return {
    asked: () =>
      spy.mock.calls.map(([url]) =>
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      ),
  };
}

const ask = (path: string, method = 'GET') =>
  relay.fetch(new Request(`https://terrain.ederer.digital${path}`, { method }));

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the demo’s My Maps relay', () => {
  it('fetches one map’s KMZ export from Google and passes on its name', async () => {
    const calls = google(
      new Response(KMZ, {
        headers: { 'Content-Disposition': 'attachment; filename="Poutine Autour du quebec.kmz"' },
      }),
    );
    const response = await ask(`/mymaps/${ID}`);
    expect(calls.asked()).toEqual([`https://www.google.com/maps/d/kml?mid=${ID}`]);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/vnd.google-earth.kmz');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toContain('Poutine Autour du quebec.kmz');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(KMZ);
  });

  it('only ever answers data: a download that can run nothing, even opened in a browser', async () => {
    google(new Response(KMZ, { headers: { 'Content-Disposition': 'inline; filename="Map.kmz"' } }));
    const shared = await ask(`/mymaps/${ID}`);
    expect(shared.headers.get('Content-Disposition')).toBe('attachment; filename="Map.kmz"');
    expect(shared.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(shared.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    vi.restoreAllMocks();
    google(new Response('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"></kml>'));
    const unnamed = await ask(`/mymaps/${ID}`);
    expect(unnamed.headers.get('Content-Disposition')).toBe(
      'attachment; filename="My Maps map.kml"',
    );
    expect((await ask('/mymaps/short')).headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; sandbox",
    );
  });

  it('asks Google nothing for anything but a map ID', async () => {
    const calls = google(new Response(KMZ));
    for (const path of [
      '/mymaps/',
      '/mymaps/short',
      '/mymaps/a%2Fb..%2Fc-1234567890',
      '/elsewhere',
    ])
      expect(await errorOf(await ask(path))).toBe('not-a-map');
    expect(await errorOf(await ask(`/mymaps/${ID}`, 'POST'))).toBe('not-a-map');
    expect(calls.asked()).toEqual([]);
  });

  it('says when a map isn’t shared: Google answers with its sign-in page', async () => {
    google(new Response('<!doctype html><title>Sign in</title>', { status: 200 }));
    const response = await ask(`/mymaps/${ID}`);
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('not-shared');
  });

  it('says when there is no such map, or Google can’t be reached', async () => {
    google(new Response('', { status: 404 }));
    expect((await ask(`/mymaps/${ID}`)).status).toBe(404);
    vi.restoreAllMocks();
    google(new TypeError('network down'));
    expect(await errorOf(await ask(`/mymaps/${ID}`))).toBe('unreachable');
  });

  it('refuses a map over 20 MB', async () => {
    google(new Response(KMZ, { headers: { 'Content-Length': String(21 * 1024 * 1024) } }));
    expect(await errorOf(await ask(`/mymaps/${ID}`))).toBe('too-big');
  });
});

describe('the demo’s background tiles', () => {
  const INDEX = 'https://tiles.openfreemap.org/planet';
  const BUILD = 'https://tiles.openfreemap.org/planet/20260927_080001_pt';
  const TILE: Uint8Array<ArrayBuffer> = new Uint8Array([0x1a, 0x02, 0x78, 0x02]);

  /** OpenFreeMap, as the relay sees it: its index naming this week's build, then one tile answer. */
  function openFreeMap(answer: Response, index: unknown = { tiles: [`${BUILD}/{z}/{x}/{y}.pbf`] }) {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((url) =>
        Promise.resolve(url === INDEX ? Response.json(index) : answer.clone()),
      );
    return {
      asked: () =>
        spy.mock.calls.map(([url]) =>
          typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
        ),
    };
  }

  it('fetches a tile from OpenFreeMap’s current build, for the browser to keep a day', async () => {
    const calls = openFreeMap(new Response(TILE));
    const response = await ask('/tiles/14/4842/5856.pbf');
    expect(calls.asked()).toEqual([INDEX, `${BUILD}/14/4842/5856.pbf`]);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/x-protobuf');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(TILE);
  });

  it('answers an empty tile where OpenFreeMap has none', async () => {
    openFreeMap(new Response('', { status: 404 }));
    const response = await ask('/tiles/3/1/2.pbf');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('asks nothing for a tile that can’t exist', async () => {
    const calls = openFreeMap(new Response(TILE));
    for (const path of [
      '/tiles/15/0/0.pbf',
      '/tiles/2/4/0.pbf',
      '/tiles/2/0/4.pbf',
      '/tiles/a/b/c.pbf',
      '/tiles/1/0/0.png',
      '/tiles/1/0/0.pbf/more',
    ])
      expect(await errorOf(await ask(path))).toBe('not-a-tile');
    expect(await errorOf(await ask('/tiles/0/0/0.pbf', 'POST'))).toBe('not-a-tile');
    expect(calls.asked()).toEqual([]);
  });

  it('says when OpenFreeMap can’t be reached, and fetches only from OpenFreeMap', async () => {
    google(new TypeError('network down'));
    expect(await errorOf(await ask('/tiles/0/0/0.pbf'))).toBe('unreachable');
    vi.restoreAllMocks();
    const calls = openFreeMap(new Response(TILE), {
      tiles: ['https://elsewhere.example/{z}/{x}/{y}.pbf'],
    });
    expect(await errorOf(await ask('/tiles/0/0/0.pbf'))).toBe('unreachable');
    expect(calls.asked()).toEqual([INDEX]);
  });
});

describe('the relay’s address lookups', () => {
  const SERVICE =
    'https://servicescarto.mrnf.gouv.qc.ca/pes/rest/services/Territoire/Adresse_Geocodage/GeocodeServer/findAddressCandidates';
  const POUTINE = {
    street: '780, rue Saint-Jean',
    town: 'Québec',
    postalCode: 'G1R 1P8',
    province: 'QC',
  };
  // Adresses Québec's answer for it: the house, then the street (named only in its label).
  const ANSWER = {
    candidates: [
      {
        address: '780 Rue Saint-Jean, Québec G1R1P9',
        location: { x: -71.21757, y: 46.81131 },
        attributes: { Num: 780, Odonyme: 'Rue Saint-Jean', City: 'Québec', ZIP: 'G1R1P9' },
      },
      {
        address: 'Rue Saint-Jean, Québec',
        location: { x: -71.21237, y: 46.81308 },
        attributes: { Num: '', Odonyme: '', City: 'Québec', ZIP: '' },
      },
    ],
  };

  const lookUp = (body: unknown, method = 'POST') =>
    relay.fetch(
      new Request('https://landagentfriend.ederer.digital/geocode', {
        method,
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      }),
    );

  it('asks Adresses Québec for each address and passes on its houses and streets', async () => {
    const calls = google(Response.json(ANSWER));
    const response = await lookUp({ addresses: [POUTINE] });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      results: [
        [
          {
            lat: 46.81131,
            lng: -71.21757,
            number: '780',
            street: 'Rue Saint-Jean',
            town: 'Québec',
            postalCode: 'G1R1P9',
          },
          {
            lat: 46.81308,
            lng: -71.21237,
            number: '',
            street: 'Rue Saint-Jean',
            town: 'Québec',
            postalCode: '',
          },
        ],
      ],
    });
    const [asked] = calls.asked();
    const url = new URL(asked ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(SERVICE);
    expect(url.searchParams.get('SingleLine')).toBe('780, rue Saint-Jean, Québec, QC G1R 1P8');
    expect(url.searchParams.get('outSR')).toBe('4326');
  });

  it('refuses anything but addresses: a name, a phone or a note never passes through', async () => {
    const calls = google(Response.json(ANSWER));
    for (const body of [
      { addresses: [{ ...POUTINE, owner: 'Marie Trempette' }] },
      { addresses: [{ ...POUTINE, phone: '450 555-0123' }] },
      { addresses: [POUTINE], notes: 'Chien' },
      { addresses: [{ ...POUTINE, street: 42 }] },
      { addresses: [{ ...POUTINE, town: '' }] },
      { addresses: [] },
      { addresses: 'everything' },
    ])
      expect(await errorOf(await lookUp(body))).toBe('not-addresses');
    expect(await errorOf(await lookUp(null, 'GET'))).toBe('not-addresses');
    expect(
      await errorOf(await lookUp({ addresses: Array.from({ length: 26 }, () => POUTINE) })),
    ).toBe('too-many');
    expect(calls.asked()).toEqual([]);
  });

  it('says when Adresses Québec can’t be reached', async () => {
    google(new TypeError('network down'));
    expect(await errorOf(await lookUp({ addresses: [POUTINE] }))).toBe('unreachable');
    vi.restoreAllMocks();
    google(new Response('busy', { status: 503 }));
    expect(await errorOf(await lookUp({ addresses: [POUTINE] }))).toBe('unreachable');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import relay from '../../relay/mymaps.js';
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

/// <reference types="vite/client" />
// The reference gives the ?url import its type in the unit tests' project too.
import sampleUrl from '../../fixtures/public/poutine-autour-du-quebec.kmz?url';

/**
 * The public demo addresses (Alex, 2026-10-05). Only there does Terrain offer the poutine sample
 * and My Maps links, and draw an online background map while connected, both through the demo's
 * relay (relay/worker.js). Everywhere else Terrain starts as a field book does: empty, waiting for
 * the user's own file, and it never fetches a map or a tile online.
 */
const DEMO_HOSTS: readonly string[] = ['terrain.ederer.digital'];

export const SAMPLE_NAME = 'Poutine Autour du quebec.kmz';

export function isPublicDemo(hostname: string): boolean {
  return DEMO_HOSTS.includes(hostname);
}

/** The sample My Maps export, shipped with the app and cached for offline use, as a picked file. */
export async function sampleFile(): Promise<File> {
  const response = await fetch(sampleUrl);
  if (!response.ok) throw new Error(`The sample answered ${String(response.status)}`);
  return new File([await response.blob()], SAMPLE_NAME);
}

/** Why a My Maps link didn't open: the relay's answer, or no connection at all. */
export type MyMapsProblem = 'not-shared' | 'not-found' | 'offline' | 'unexpected';

export class MyMapsError extends Error {
  readonly problem: MyMapsProblem;

  constructor(problem: MyMapsProblem) {
    super(problem);
    this.name = 'MyMapsError';
    this.problem = problem;
  }
}

/** The file name Google gave the map (filename* first, then filename), else a plain one. */
export function fileNameFrom(disposition: string | null): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // Malformed: fall through to the plain name.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition ?? '')?.[1]?.trim();
  return plain ? plain : 'My Maps map.kmz';
}

/** One My Maps map, fetched through the demo's relay, as a picked file named after the map. */
export async function myMapsFile(id: string): Promise<File> {
  let response: Response;
  try {
    response = await fetch(`/mymaps/${encodeURIComponent(id)}`);
  } catch {
    throw new MyMapsError('offline');
  }
  if (response.status === 403) throw new MyMapsError('not-shared');
  if (response.status === 404) throw new MyMapsError('not-found');
  if (!response.ok) throw new MyMapsError('unexpected');
  return new File(
    [await response.blob()],
    fileNameFrom(response.headers.get('Content-Disposition')),
  );
}

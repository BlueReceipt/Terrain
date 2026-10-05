/// <reference types="vite/client" />
// The reference gives the ?url import its type in the unit tests' project too.
import sampleUrl from '../../fixtures/public/poutine-autour-du-quebec.kmz?url';

/**
 * The public demo addresses, where the first screen offers the poutine sample (Alex, 2026-10-05).
 * Everywhere else, Terrain starts as a field book does: empty, waiting for the user's own file.
 */
const SAMPLE_HOSTS: readonly string[] = ['terrain.ederer.digital'];

export const SAMPLE_NAME = 'Poutine Autour du quebec.kmz';

export function offersSample(hostname: string): boolean {
  return SAMPLE_HOSTS.includes(hostname);
}

/** The sample My Maps export, shipped with the app and cached for offline use, as a picked file. */
export async function sampleFile(): Promise<File> {
  const response = await fetch(sampleUrl);
  if (!response.ok) throw new Error(`The sample answered ${String(response.status)}`);
  return new File([await response.blob()], SAMPLE_NAME);
}

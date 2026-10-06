import type { AddressCandidate, AddressQuery } from '../domain/addresses.ts';

/** Addresses per request; the relay takes up to 25. */
const BATCH = 25;

export class LookUpError extends Error {
  constructor(status: number) {
    super(`The relay answered ${String(status)}`);
    this.name = 'LookUpError';
  }
}

/**
 * Asks Terrain's relay (`/geocode`, on Terrain's own address) where these addresses are, a batch at
 * a time, until done or `stopped`. Each request carries the four address fields of each house and
 * nothing else, whatever else a query object holds. Throws when the relay can't answer; what was
 * found before stays found.
 */
export async function lookUpAddresses(
  queries: readonly AddressQuery[],
  found: (query: AddressQuery, candidates: AddressCandidate[]) => void,
  stopped: () => boolean,
): Promise<void> {
  for (let start = 0; start < queries.length && !stopped(); start += BATCH) {
    const batch = queries.slice(start, start + BATCH);
    const response = await fetch('/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        addresses: batch.map(({ street, town, postalCode, province }) => ({
          street,
          town,
          postalCode,
          province,
        })),
      }),
    });
    if (!response.ok) throw new LookUpError(response.status);
    const { results } = (await response.json()) as { results: AddressCandidate[][] };
    batch.forEach((query, i) => {
      found(query, results[i] ?? []);
    });
  }
}

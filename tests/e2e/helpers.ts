import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

export const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'public');

/**
 * Waits for the service worker to install and take over. The first install caches the whole app
 * (about 3 MB): with every test worker starting Chrome at once, that can take more than 5 seconds.
 */
export async function swActive(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), {
      timeout: 30_000,
    })
    .toBe('activated');
}

/** Loads the app, waits for the service worker to take over, then cuts the network (§11). */
export async function offlineAfterFirstLoad(page: Page): Promise<void> {
  await page.goto('/');
  await swActive(page);
  await page.context().setOffline(true);
  await page.reload();
}

export async function importFile(page: Page, name: string): Promise<void> {
  await page.locator('input[type=file][accept*=".kmz"]').setInputFiles(join(FIXTURES, name));
}

/** Imports the gate fixture into a new campaign and opens it on the map. */
export async function openCases(page: Page): Promise<void> {
  await importFile(page, 'cases.kmz');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);
}

export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

/** The map has drawn its style and Terrain's pins. */
export async function mapReady(page: Page): Promise<void> {
  await expect(page.getByRole('search')).toBeVisible();
  await page.waitForFunction(() => {
    const map = window.terrainMap;
    return Boolean(map?.isStyleLoaded() && map.getSource('terrain-pins'));
  });
}

export interface ShownPin {
  id: string;
  badge: string;
  houses: number;
  color: string;
  ring: boolean;
  linked: boolean;
  selected: boolean;
  lng: number;
  lat: number;
}

/** Terrain's pins as the map holds them. */
export async function pins(page: Page): Promise<ShownPin[]> {
  return page.evaluate(() => {
    const map = window.terrainMap;
    const source = map?.getSource('terrain-pins') as
      | {
          serialize(): {
            data: {
              features: {
                properties: Record<string, unknown>;
                geometry: { coordinates: [number, number] };
              }[];
            };
          };
        }
      | undefined;
    return (source?.serialize().data.features ?? []).map((feature) => ({
      id: String(feature.properties.id),
      badge: String(feature.properties.badge),
      houses: Number(feature.properties.houses),
      color: String(feature.properties.color),
      ring: feature.properties.ring === true,
      linked: feature.properties.linked === true,
      selected: feature.properties.selected === true,
      lng: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
    }));
  });
}

/** Waits for the map to stop moving. */
export async function mapIdle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const map = window.terrainMap;
    if (!map) return;
    await new Promise<void>((done) => {
      if (!map.isMoving() && map.loaded()) done();
      else
        map.once('idle', () => {
          done();
        });
    });
  });
}

/** Centers the map on a place, waits until it is drawn there, then taps it. */
export async function tapAt(page: Page, lng: number, lat: number, zoom = 16): Promise<void> {
  const point = await page.evaluate(
    async ([x, y, z]) => {
      const map = window.terrainMap;
      if (!map) throw new Error('No map');
      map.jumpTo({ center: [x, y], zoom: z, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
      // A tap finds pins among what is drawn: wait for the frame at the new place.
      await new Promise<void>((done) => {
        map.once('idle', () => {
          done();
        });
        map.triggerRepaint();
      });
      const at = map.project([x, y]);
      const box = map.getContainer().getBoundingClientRect();
      return { x: box.left + at.x, y: box.top + at.y };
    },
    [lng, lat, zoom] as const,
  );
  await page.mouse.click(point.x, point.y);
}

/** The rows as Terrain stored them, read straight from IndexedDB. */
export async function storedRows(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const open = indexedDB.open('terrain');
        open.onerror = () => {
          reject(new Error('Could not open the database'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('rows', 'readonly').objectStore('rows').getAll();
          request.onsuccess = () => {
            resolve(request.result as Record<string, unknown>[]);
            db.close();
          };
          request.onerror = () => {
            reject(new Error('Could not read the rows'));
          };
        };
      }),
  );
}

/** One stored row by its parcel ID cell and first name. */
export async function storedRow(
  page: Page,
  parcelId: string,
  firstName: string,
): Promise<Record<string, unknown>> {
  const row = (await storedRows(page)).find(
    (candidate) =>
      candidate.parcelIdRaw === parcelId &&
      (candidate.sourceFields as Record<string, string>).PRENOM === firstName,
  );
  if (!row) throw new Error(`No stored row ${parcelId} ${firstName}`);
  return row;
}

/** Taps a house's pin and waits for its card. */
export async function openHouse(
  page: Page,
  place: readonly [number, number],
  address: string,
): Promise<Locator> {
  await tapAt(page, ...place);
  const card = page.getByRole('region', { name: address });
  await expect(card).toBeVisible();
  return card;
}

/** A tap on the house rail. */
export async function mark(card: Locator, status: string): Promise<void> {
  await card
    .getByRole('group', { name: 'Mark the house' })
    .getByRole('button', { name: status })
    .click();
}

export async function closeCard(card: Locator): Promise<void> {
  await card.getByRole('button', { name: 'Close', exact: true }).click();
}

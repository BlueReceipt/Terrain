import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES,
  importFile,
  mapIdle,
  mapReady,
  offlineAfterFirstLoad,
  openCases,
  openSettings,
  pins,
  tapAt,
} from './helpers.ts';

// Positions in fixtures/public/cases.kmz (scripts/make-fixtures.ts).
const TREMPETTE = [-73.6105, 45.2641] as const;
const VILLAGE_CENTER = [-73.5302, 45.2803] as const;

/** Console errors (CSP violations included) and requests that leave the app's origin. */
function watch(page: Page, baseURL: string | undefined) {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin)
      problems.push(`left the origin: ${request.url()}`);
  });
  return problems;
}

test('shows one pin per house with its row count, and the banner without an offline map', async ({
  page,
  baseURL,
}) => {
  const problems = watch(page, baseURL);
  const tiles: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/tiles/')) tiles.push(request.url());
  });
  await offlineAfterFirstLoad(page);
  await openCases(page);
  await expect(
    page.getByRole('button', { name: 'No offline map loaded. Add one in Settings.' }),
  ).toBeVisible();
  const shown = await pins(page);
  // 20 houses: 3 have no position yet, and 2 share the village center.
  expect(shown).toHaveLength(16);
  expect(shown.filter((pin) => pin.badge === '3')).toHaveLength(1);
  expect(shown.filter((pin) => pin.badge === '2').length).toBeGreaterThanOrEqual(1);
  // The file's shape, point and My Maps route are drawn under the pins, muted.
  const reference = await page.evaluate(() => {
    const source = window.terrainMap?.getSource('terrain-reference') as
      { serialize(): { data: { features: { geometry: { type: string } }[] } } } | undefined;
    return (source?.serialize().data.features ?? []).map((feature) => feature.geometry.type);
  });
  expect(reference).toEqual(['Polygon', 'Point', 'LineString', 'Point']);
  // Away from the public demo, no online map: Terrain asks for no tiles at all.
  const sources = await page.evaluate(() =>
    Object.keys(window.terrainMap?.getStyle().sources ?? {}),
  );
  expect(sources).not.toContain('openfreemap');
  expect(tiles).toEqual([]);
  expect(problems).toEqual([]);
});

test('opens a house’s card from its pin, and a chooser where houses share a spot', async ({
  page,
}) => {
  await offlineAfterFirstLoad(page);
  await openCases(page);

  await tapAt(page, ...TREMPETTE);
  const card = page.getByRole('region', { name: '123, rue Saint-Paul' });
  await expect(card).toBeVisible();
  await expect(card.getByText('3 entries')).toBeVisible();
  await expect(card.locator('.owner')).toHaveCount(3);
  await expect(
    card.getByRole('button', { name: /^P1-216B also at 12, chemin du Lac: Luc Trempette/ }),
  ).toBeVisible();
  // The lot tether: Luc's house, on P1-216B too, gets the small ring.
  expect((await pins(page)).filter((pin) => pin.linked)).toHaveLength(1);

  await card.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('toolbar', { name: 'Show houses by status' })).toBeVisible();

  await tapAt(page, ...VILLAGE_CENTER);
  const chooser = page.getByRole('region', { name: /houses on this spot$/ });
  await expect(chooser).toBeVisible();
  const choices = chooser.locator('.result');
  await expect(choices).toHaveCount(2);
  const first = (await choices.first().locator('.strong').textContent()) ?? '';
  await choices.first().click();
  await expect(page.getByRole('region', { name: first })).toBeVisible();
});

test('loads an offline map file, then draws it offline with French labels', async ({
  page,
  baseURL,
}) => {
  const problems = watch(page, baseURL);
  const glyphs: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/map-assets/glyphs/') && response.ok())
      glyphs.push(response.url());
  });
  await offlineAfterFirstLoad(page);
  await openCases(page);
  await openSettings(page);
  await page
    .locator('input[type=file][accept*=".pmtiles"]')
    .setInputFiles(join(FIXTURES, 'test-basemap.pmtiles'));
  await expect(page.getByText('test-basemap.pmtiles, 0.0 MB')).toBeVisible();
  await expect(page.getByText('Zoom 0 to 13')).toBeVisible();
  await page.getByRole('button', { name: '← Map' }).click();
  await mapReady(page);
  await expect(
    page.getByRole('button', { name: 'No offline map loaded. Add one in Settings.' }),
  ).toBeHidden();

  const labels = await page.evaluate(async () => {
    const map = window.terrainMap;
    if (!map) return [];
    map.jumpTo({ center: [-73.56, 45.255], zoom: 11.5 });
    await new Promise<void>((done) => {
      map.once('idle', () => {
        done();
      });
    });
    return map
      .queryRenderedFeatures({ layers: ['places_locality'] })
      .map((feature) => String(feature.properties.name));
  });
  expect(labels).toContain('Saint-Rémi');
  expect(labels).toContain('Saint-Édouard');
  expect(glyphs.some((url) => url.includes('Atkinson%20Hyperlegible%20Next'))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('basemap.png') });
  expect(problems).toEqual([]);

  // The map stays after a reload, and Remove takes it away.
  await page.reload();
  await mapReady(page);
  await expect(
    page.getByRole('button', { name: 'No offline map loaded. Add one in Settings.' }),
  ).toBeHidden();
  await openSettings(page);
  await page.getByRole('button', { name: 'Remove the map' }).click();
  await expect(
    page.getByText('No offline map loaded. Pins still show, on a plain background.'),
  ).toBeVisible();
});

test('searches parcel IDs, owners, lot numbers and every other cell', async ({ page }) => {
  await offlineAfterFirstLoad(page);
  await openCases(page);
  const searchField = page.getByRole('searchbox', { name: 'Search parcel, owner, lot or address' });

  await searchField.fill('p1-216b');
  const results = page.getByRole('list', { name: 'Search parcel, owner, lot or address' });
  await expect(results.locator('.result')).toHaveCount(3);
  await results.getByRole('button', { name: /Marie Trempette/ }).click();
  const card = page.getByRole('region', { name: '123, rue Saint-Paul' });
  await expect(card.locator('.highlighted .owner')).toHaveText(/Marie Trempette/);

  await searchField.fill('1 234 500');
  await page.getByRole('button', { name: /^NUM_LOT 1 234 500: 2 houses$/ }).click();
  await expect(
    page.getByRole('region', { name: 'NUM_LOT 1 234 500' }).locator('.result'),
  ).toHaveCount(2);

  // A match in any other column names it; the result wraps across the bar, nothing scrolls sideways.
  await searchField.fill('555-0177');
  await expect(results.getByRole('button', { name: /CELLULAIRE: 450 555-0177$/ })).toBeVisible();
  const sizes = await results.evaluate((list) => ({
    list: list.getBoundingClientRect().width,
    field: document.querySelector('.search-input')?.getBoundingClientRect().width ?? 0,
    overflow: list.scrollWidth - list.clientWidth,
  }));
  expect(sizes.list).toBeGreaterThan(sizes.field);
  expect(sizes.overflow).toBe(0);
});

test('filters houses by status, and lists the houses with no position yet', async ({ page }) => {
  await offlineAfterFirstLoad(page);
  await openCases(page);
  const all = (await pins(page)).length;
  const chips = page.getByRole('toolbar', { name: 'Show houses by status' }).getByRole('button');
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await pins(page)).length).toBeLessThan(all);
  await chips.nth(1).click();
  await expect.poll(async () => (await pins(page)).length).toBe(all);

  await page.getByRole('button', { name: '3 houses not on the map' }).click();
  const list = page.getByRole('region', { name: 'Houses with no position yet' });
  await expect(list.locator('.result')).toHaveCount(3);
  await list.locator('.result').first().click();
  await expect(page.getByText('Not on the map yet')).toBeVisible();
});

test('draws the selection ring on a black pin and on a yellow one, above the card', async ({
  page,
}) => {
  await offlineAfterFirstLoad(page);
  await openCases(page);
  for (const color of ['#000000', '#FFEA00']) {
    // A single house of that color: a spot shared by houses opens the chooser instead.
    const pin = (await pins(page)).find(
      (candidate) => candidate.color === color && candidate.houses === 1,
    );
    if (!pin) throw new Error(`No ${color} pin in the fixture`);
    await tapAt(page, pin.lng, pin.lat);
    await expect
      .poll(async () => (await pins(page)).find((p) => p.id === pin.id)?.selected)
      .toBe(true);
    await mapIdle(page);
    // The pin shows above the card, not under it.
    const at = await page.evaluate(
      ([lng, lat]) => window.terrainMap?.project([lng, lat]) ?? { x: 0, y: 0 },
      [pin.lng, pin.lat] as const,
    );
    const cardTop = (await page.locator('.card').boundingBox())?.y ?? 0;
    expect(at.y).toBeLessThan(cardTop);
    await page.screenshot({
      path: test.info().outputPath(`selected-${color.slice(1)}.png`),
      clip: { x: at.x - 40, y: at.y - 40, width: 80, height: 80 },
    });
    await page.getByRole('button', { name: 'Close' }).click();
  }
});

test('imports the 2,000-row fixture and shows its pins', async ({ page }) => {
  await offlineAfterFirstLoad(page);
  await importFile(page, 'big-2000.kmz');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);
  // 2,000 rows: 414 pins (houses with several rows, shared spots), 787 houses with no position.
  expect(await pins(page)).toHaveLength(414);
  // Panning and zooming keep drawing: the whole sequence ends in under 5 s, even headless.
  const took = await page.evaluate(async () => {
    const map = window.terrainMap;
    if (!map) return Infinity;
    const start = performance.now();
    for (const [dx, dy] of [
      [200, 0],
      [0, 200],
      [-200, 0],
      [0, -200],
    ] as const) {
      map.panBy([dx, dy], { duration: 0 });
      map.zoomTo(map.getZoom() + 1, { duration: 0 });
      await new Promise<void>((done) => {
        map.once('idle', () => {
          done();
        });
      });
    }
    return performance.now() - start;
  });
  expect(took).toBeLessThan(5000);
});

test.describe('with the phone’s position', () => {
  test.use({
    geolocation: { latitude: TREMPETTE[1], longitude: TREMPETTE[0], accuracy: 12 },
    permissions: ['geolocation'],
  });

  test('shows the GPS dot and centers on it', async ({ page }) => {
    await offlineAfterFirstLoad(page);
    await openCases(page);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = window.terrainMap?.getSource('terrain-me') as
            { serialize(): { data: { features: unknown[] } } } | undefined;
          return source?.serialize().data.features.length ?? 0;
        }),
      )
      .toBe(2);
    await page.evaluate(() => window.terrainMap?.jumpTo({ center: [-73.5, 45.3], zoom: 10 }));
    await page.getByRole('button', { name: 'Show where I am' }).click();
    await expect
      .poll(() => page.evaluate(() => window.terrainMap?.getCenter().lng ?? 0))
      .toBeCloseTo(TREMPETTE[0], 2);
  });

  test('offers the house it stands at, one tap from its card', async ({ page }) => {
    await offlineAfterFirstLoad(page);
    await openCases(page);
    const here = page.getByRole('button', { name: 'You’re at 123, rue Saint-Paul' });
    await here.click();
    await expect(page.getByRole('region', { name: '123, rue Saint-Paul' })).toBeVisible();
    // While the card is open, the chip makes way.
    await expect(here).toBeHidden();
  });
});

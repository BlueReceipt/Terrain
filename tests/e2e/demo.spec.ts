import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, mapReady, pins, swActive } from './helpers.ts';

async function problems(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
}

// The build, reached as the public demo address: only there does the first screen offer the
// poutine sample and My Maps links. Chrome treats that plain-http address as secure, as it is online.
const DEMO = 'http://terrain.ederer.digital:4173/';
test.use({
  launchOptions: {
    args: [
      '--host-resolver-rules=MAP terrain.ederer.digital localhost',
      '--unsafely-treat-insecure-origin-as-secure=http://terrain.ederer.digital:4173',
    ],
  },
});

// A made-up map ID, shaped like Google's.
const ID = '1PoutineSampleMapIdForTests_0123456';
const SAMPLE = readFileSync(join(FIXTURES, 'poutine-autour-du-quebec.kmz'));

/** The demo's relay (relay/mymaps.js), standing in for Cloudflare and Google. */
async function relayAnswers(page: Page, answer: 'map' | 'not-shared'): Promise<string[]> {
  const asked: string[] = [];
  await page.context().route('**/mymaps/**', (route) => {
    asked.push(new URL(route.request().url()).pathname);
    return answer === 'map'
      ? route.fulfill({
          contentType: 'application/vnd.google-earth.kmz',
          headers: { 'Content-Disposition': 'attachment; filename="Poutine Autour du quebec.kmz"' },
          body: SAMPLE,
        })
      : route.fulfill({ status: 403, json: { error: 'not-shared' } });
  });
  return asked;
}

async function openMapIn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);
  const shown = await pins(page);
  expect(shown.reduce((houses, pin) => houses + pin.houses, 0)).toBe(114);
}

test('the public demo imports the poutine sample offline: 114 houses, every one on the map', async ({
  page,
}) => {
  await page.goto(DEMO);
  await swActive(page);
  await page.context().setOffline(true);
  await page.reload();

  await expect(page.getByText('Try Terrain with 124 poutine places across Québec')).toBeVisible();
  await page.getByRole('button', { name: 'Try the poutine sample' }).click();
  await openMapIn(page);
});

test('the public demo opens a My Maps map by its link, through its relay', async ({ page }) => {
  const asked = await relayAnswers(page, 'map');
  await page.goto(DEMO);
  await page.getByRole('button', { name: 'Open a My Maps link' }).click();
  const link = page.getByRole('textbox', { name: 'My Maps link' });
  await expect(link).toBeFocused();

  await link.fill('https://maps.app.goo.gl/abcdef');
  await page.getByRole('button', { name: 'Open the map' }).click();
  await expect(page.getByRole('alert')).toHaveText(/This isn’t a My Maps link/);
  expect(asked).toEqual([]);

  await link.fill(`https://www.google.com/maps/d/edit?mid=${ID}&usp=sharing`);
  await page.getByRole('button', { name: 'Open the map' }).click();
  await openMapIn(page);
  expect(asked).toEqual([`/mymaps/${ID}`]);
});

test('the public demo explains a map that isn’t shared, and lets you try another link', async ({
  page,
}) => {
  await relayAnswers(page, 'not-shared');
  await page.goto(DEMO);
  await page.getByRole('button', { name: 'Open a My Maps link' }).click();
  await page
    .getByRole('textbox', { name: 'My Maps link' })
    .fill(`<iframe src="https://www.google.com/maps/d/embed?mid=${ID}&amp;ehbc=2E312F"></iframe>`);
  await page.getByRole('button', { name: 'Open the map' }).click();
  await expect(page.getByRole('heading', { name: 'This map can’t be opened' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(/Anyone with the link can view/);
  await page.getByRole('button', { name: 'Try another link' }).click();
  await expect(page.getByRole('button', { name: 'Open a My Maps link' })).toBeVisible();
});

test('the public demo follows a network-link file to its map', async ({ page }) => {
  const asked = await relayAnswers(page, 'map');
  await page.goto(DEMO);
  await page.locator('input[type=file][accept*=".kmz"]').setInputFiles({
    name: 'Poutine Autour du quebec.kml',
    mimeType: 'application/vnd.google-earth.kml+xml',
    buffer: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Poutine Autour du quebec</name><NetworkLink><name>Poutine Autour du quebec</name><Link><href>https://www.google.com/maps/d/kml?mid=${ID}</href></Link></NetworkLink></Document></kml>`,
    ),
  });
  await openMapIn(page);
  expect(asked).toEqual([`/mymaps/${ID}`]);
});

test('the demo’s first screen, link box and link error meet WCAG 2.2 AA', async ({ page }) => {
  await relayAnswers(page, 'not-shared');
  await page.goto(DEMO);
  expect(await problems(page)).toEqual([]);
  await page.getByRole('button', { name: 'Open a My Maps link' }).click();
  await page.getByRole('textbox', { name: 'My Maps link' }).fill('not a link');
  await page.getByRole('button', { name: 'Open the map' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await problems(page)).toEqual([]);
  await page
    .getByRole('textbox', { name: 'My Maps link' })
    .fill(`https://www.google.com/maps/d/viewer?mid=${ID}`);
  await page.getByRole('button', { name: 'Open the map' }).click();
  await expect(page.getByRole('heading', { name: 'This map can’t be opened' })).toBeVisible();
  expect(await problems(page)).toEqual([]);
});

test('any other address starts empty, with no sample, no links and no network-link fetching', async ({
  page,
}) => {
  const asked = await relayAnswers(page, 'map');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the poutine sample' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open a My Maps link' })).toHaveCount(0);
  await page.locator('input[type=file][accept*=".kmz"]').setInputFiles({
    name: 'Linked.kml',
    mimeType: 'application/vnd.google-earth.kml+xml',
    buffer: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><NetworkLink><Link><href>https://www.google.com/maps/d/kml?mid=${ID}</href></Link></NetworkLink></Document></kml>`,
    ),
  });
  await expect(page.getByRole('alert')).toHaveText(/only links to your map online/);
  expect(asked).toEqual([]);
});

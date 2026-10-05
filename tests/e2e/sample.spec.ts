import { expect, test } from '@playwright/test';
import { mapReady, pins, swActive } from './helpers.ts';

// The build, reached as the public demo address: only there does the first screen offer the
// poutine sample. Chrome treats that plain-http address as secure, as it will be online.
const DEMO = 'http://terrain.ederer.digital:4173/';
test.use({
  launchOptions: {
    args: [
      '--host-resolver-rules=MAP terrain.ederer.digital localhost',
      '--unsafely-treat-insecure-origin-as-secure=http://terrain.ederer.digital:4173',
    ],
  },
});

test('the public demo imports the poutine sample offline: 114 houses, every one on the map', async ({
  page,
}) => {
  await page.goto(DEMO);
  await swActive(page);
  await page.context().setOffline(true);
  await page.reload();

  await expect(page.getByText('Try Terrain with 124 poutine places across Québec')).toBeVisible();
  await page.getByRole('button', { name: 'Try the poutine sample' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);
  const shown = await pins(page);
  expect(shown.reduce((houses, pin) => houses + pin.houses, 0)).toBe(114);
});

test('any other address starts empty, without the sample', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the poutine sample' })).toHaveCount(0);
});

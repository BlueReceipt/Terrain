import { expect, test, type Page } from '@playwright/test';
import { importFile, mapReady, offlineAfterFirstLoad, openSettings } from './helpers.ts';

function section(page: Page, title: string) {
  return page.locator('details.section', { has: page.locator('summary', { hasText: title }) });
}

test('imports a My Maps export offline, reports it, and keeps the campaign', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await offlineAfterFirstLoad(page);
  await expect(page.getByRole('button', { name: 'Import file' })).toBeVisible();

  await importFile(page, 'cases.kmz');
  await expect(page.getByRole('heading', { name: 'Pin colors' })).toBeVisible();
  await expect(page.getByText('No match: check this one')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Import report' })).toBeVisible();
  await expect(page.getByText('28 rows in cases.kmz')).toBeVisible();
  await expect(section(page, 'Houses with more than one row').locator('.section-count')).toHaveText(
    '7',
  );
  await expect(section(page, 'Houses with no position yet').locator('.section-count')).toHaveText(
    '3',
  );
  await expect(section(page, 'Different houses on one spot').locator('.section-count')).toHaveText(
    '1',
  );
  await expect(
    section(page, 'Parcels at more than one house').locator('.section-count'),
  ).toHaveText('2');

  await section(page, 'Houses with more than one row').locator('summary').click();
  const trempette = section(page, 'Houses with more than one row')
    .locator('li', { hasText: '123, rue Saint-Paul' })
    .first();
  await expect(trempette.locator('.row-line')).toHaveCount(3);

  // Grouping lots by NUM_LOT recounts on the spot.
  await page.getByLabel('Group rows into lots by').selectOption('NUM_LOT');
  await expect(
    section(page, 'Parcels at more than one house').locator('.section-count'),
  ).toHaveText('2');
  await page.getByLabel('Group rows into lots by').selectOption('');

  // Marking the crossed-out ID as old takes the row off that lot.
  await section(page, 'Cells listing several parcel IDs').locator('summary').click();
  await page.getByRole('button', { name: 'P08-132A is old' }).click();
  await expect(page.getByRole('button', { name: 'P08-132A is old' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    section(page, 'Parcels at more than one house').locator('.section-count'),
  ).toHaveText('1');

  // The campaign opens on its map; its summary lives in Settings.
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);
  await openSettings(page);
  await expect(page.getByText('28 rows at 20 houses')).toBeVisible();

  // The last campaign opens on launch, offline.
  await page.reload();
  await mapReady(page);

  // Re-importing the same file changes nothing.
  await openSettings(page);
  await importFile(page, 'cases.kmz');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.counts')).toContainText('Unchanged28');
  expect(errors).toEqual([]);
});

test('refuses a spreadsheet without coordinates, with directions', async ({ page }) => {
  await offlineAfterFirstLoad(page);
  await importFile(page, 'no-coordinates.xlsx');
  await expect(page.getByRole('alert')).toHaveText(
    'This file has no coordinates. Import it into My Maps once, then export the layer as KMZ and import that here.',
  );
});

test('asks for the missing columns of a spreadsheet, then imports it', async ({ page }) => {
  await offlineAfterFirstLoad(page);
  await importFile(page, 'cases.xlsx');
  await expect(page.getByRole('heading', { name: 'Match the columns' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('6 rows in cases.xlsx')).toBeVisible();
});

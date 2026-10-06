import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  FIXTURES,
  importFile,
  mapReady,
  offlineAfterFirstLoad,
  openHouse,
  openSettings,
} from './helpers.ts';

function section(page: Page, title: string) {
  return page.locator('details.section', { has: page.locator('summary', { hasText: title }) });
}

/** cases.kmz as the client sends it again: Rosalie Frite bought Marie Trempette's part. */
async function soldFile() {
  const files = unzipSync(new Uint8Array(await readFile(join(FIXTURES, 'cases.kmz'))));
  const kml = strFromU8(files['doc.kml'] ?? new Uint8Array())
    .split('<Placemark>')
    .map((mark) =>
      mark.includes('<Data name="PRENOM"><value>Marie</value>')
        ? mark
            .replaceAll('Marie', 'Rosalie')
            .replaceAll('Trempette', 'Frite')
            .replaceAll('514 555-0199', '418 555-0150')
        : mark,
    )
    .join('<Placemark>');
  return {
    name: 'cases.kmz',
    mimeType: 'application/vnd.google-earth.kmz',
    buffer: Buffer.from(zipSync({ ...files, 'doc.kml': strToU8(kml) })),
  };
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
  // P1-216B only: P08-132A's two addresses are on two lot numbers, so not one plot.
  await expect(
    section(page, 'Parcels at more than one house').locator('.section-count'),
  ).toHaveText('1');

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

test('a file naming someone else lists the new owner, and the row starts over with Previous info', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-09-26T14:32:00-04:00'));
  await offlineAfterFirstLoad(page);
  await importFile(page, 'cases.kmz');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);

  await openSettings(page);
  await page.locator('input[type=file][accept*=".kmz"]').setInputFiles(await soldFile());
  await page.getByRole('button', { name: 'Continue' }).click();
  const owners = section(page, 'New owners');
  await expect(owners.locator('.section-count')).toHaveText('1');
  await owners.locator('summary').click();
  await expect(owners.locator('.row-line')).toHaveText('P1-216B Marie Trempette → Rosalie Frite');
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);

  const card = await openHouse(page, [-73.6105, 45.2641], '123, rue Saint-Paul');
  await expect(card.locator('.owner-previous')).toHaveText(
    'Previous info: Marie Trempette, 450 555-0100, 514 555-0199 (until 26.09.2026)',
  );
});

test('refuses a spreadsheet without coordinates, with directions', async ({ page }) => {
  await offlineAfterFirstLoad(page);
  await importFile(page, 'no-coordinates.xlsx');
  await expect(page.getByRole('alert')).toHaveText(
    'This file has no coordinates, and no street and town to find its houses from. Add Latitude and Longitude columns, or address and town columns (ADRESSE and MUNICIPALITE), then import it again.',
  );
});

test('asks for the missing columns of a spreadsheet, then imports it', async ({ page }) => {
  await offlineAfterFirstLoad(page);
  await importFile(page, 'cases.xlsx');
  await expect(page.getByRole('heading', { name: 'Match the columns' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('6 rows in cases.xlsx')).toBeVisible();
});

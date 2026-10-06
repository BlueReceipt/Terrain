import { expect, test } from '@playwright/test';
import { mapReady, offlineAfterFirstLoad, openCases, openSettings } from './helpers.ts';

test('backs up everything to one file, and a new phone restores it, offline', async ({ page }) => {
  await offlineAfterFirstLoad(page);
  await openCases(page);
  await openSettings(page);
  await expect(page.getByText('28 rows at 20 houses')).toBeVisible();

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^Terrain_backup_\d{4}-\d{2}-\d{2}\.json$/);
  const backup = await download.path();
  await expect(page.getByRole('status')).toContainText('Saved Terrain_backup_');

  // A new phone: nothing stored yet.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('terrain');
        request.onsuccess = () => {
          resolve();
        };
        request.onerror = () => {
          reject(new Error('Could not delete the database'));
        };
      }),
  );
  await page.reload();
  await expect(
    page.getByText('Import the client’s Excel, or a KMZ export from My Maps, to start a campaign.'),
  ).toBeVisible();

  await page.locator('input[type=file][accept*=".json"]').setInputFiles(backup);
  await expect(page.getByRole('heading', { name: 'Restore this backup?' })).toBeVisible();
  await expect(page.getByText('cases: 28 rows')).toBeVisible();
  await page.getByRole('button', { name: 'Replace with backup' }).click();
  await mapReady(page);
  await openSettings(page);
  await expect(page.getByText('28 rows at 20 houses')).toBeVisible();

  // A file that isn't a backup changes nothing.
  await page
    .locator('input[type=file][accept*=".json"]')
    .setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByText('This file isn’t a Terrain backup.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await mapReady(page);
});

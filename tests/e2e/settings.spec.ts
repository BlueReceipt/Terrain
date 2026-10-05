import { expect, test, type Page } from '@playwright/test';
import {
  closeCard,
  importFile,
  mapReady,
  mark,
  offlineAfterFirstLoad,
  openCases,
  openHouse,
  openSettings,
  storedRow,
} from './helpers.ts';

// Every change made in Settings shows where it matters, offline.
const TREMPETTE = [-73.6105, 45.2641] as const;
const LUC = [-73.59263, 45.272185] as const;
const RUE_SAINT_PAUL = '123, rue Saint-Paul';

test.use({ timezoneId: 'America/Toronto' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-26T14:32:00-04:00'));
  await offlineAfterFirstLoad(page);
  await openCases(page);
});

async function backToMap(page: Page) {
  await page.getByRole('button', { name: '← Map' }).click();
  await mapReady(page);
}

test('a status edited in Settings is on the rail and in Package status', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Edit Skipped' }).click();
  const form = page.locator('.status-form');
  await form.getByLabel('Label').fill('Absent');
  await form.getByLabel('Package status text').fill('Absent');
  await form.getByLabel('Color (#RRGGBB)').fill('#7b1fa');
  await expect(form.getByRole('alert')).toHaveText(/like #0F9D58/);
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
  await form.getByLabel('Color (#RRGGBB)').fill('#7b1fa2');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.status-item').filter({ hasText: 'Absent' })).toBeVisible();

  await backToMap(page);
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'Absent');
  expect(await storedRow(page, 'P1-216B', 'Marie')).toMatchObject({
    statusId: 'skipped',
    packageStatusText: 'Absent',
  });
});

test('the date format and the call outcomes follow Settings', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('radio', { name: '2026-09-26 14:32' }).check();
  await page.getByRole('button', { name: 'Add an outcome' }).click();
  const added = page.getByRole('textbox', { name: 'Outcome 6' });
  await expect(added).toHaveValue('New outcome');
  await added.fill('Rappeler au printemps');
  await added.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Outcome 6' })).toHaveValue(
    'Rappeler au printemps',
  );

  await backToMap(page);
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'Given');
  await card.getByRole('button', { name: 'Log call', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Which number did you call?' })
    .getByRole('button', { name: 'Another number: the whole house' })
    .click();
  await page
    .getByRole('dialog', { name: 'How did the call go?' })
    .getByRole('button', { name: 'Rappeler au printemps' })
    .click();
  await expect
    .poll(async () => (await storedRow(page, 'P1-216B', 'Alain')).callResult)
    .toBe('Rappeler au printemps');
  await closeCard(card);

  const lucCard = await openHouse(page, LUC, '12, chemin du Lac');
  await lucCard.getByRole('button', { name: 'Show everything' }).click();
  await expect(lucCard.locator('.note > p:first-child')).toHaveText([
    'Given with Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 2026-09-26 14:32',
  ]);
});

test('lots regroup at once, and a column made a house field shows once in Edit info', async ({
  page,
}) => {
  await openSettings(page);
  await page.getByRole('combobox', { name: 'Group rows into lots by' }).selectOption('NUM_LOT');
  await expect(page.getByText('2 lots are at more than one house.')).toBeVisible();
  await page.getByRole('combobox', { name: /^TEL_RES/ }).selectOption('house');

  await backToMap(page);
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await card.getByRole('button', { name: 'Show everything' }).click();
  await card.getByRole('button', { name: 'Edit info' }).click();
  const form = page.getByRole('dialog', { name: `Edit info: ${RUE_SAINT_PAUL}` });
  const section = (title: string) =>
    form.locator('fieldset', { has: page.locator('legend', { hasText: title }) });
  await expect(section('Same for the whole house').getByLabel('TEL_RES')).toHaveValue(
    '450 555-0100',
  );
  await expect(section('Alain Trempette').getByLabel('TEL_RES')).toHaveCount(0);
});

test('campaigns: rename, switch to another, delete after confirming', async ({ page }) => {
  test.setTimeout(120_000);
  await openSettings(page);
  const name = page.getByRole('textbox', { name: 'Campaign name' });
  await name.fill('Zone 3');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('button', { name: 'Rename' })).toBeDisabled();

  // A second campaign: the 2,000-row file, its parcel IDs all new.
  await importFile(page, 'big-2000.kmz');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start a new campaign' }).click();
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);

  await openSettings(page);
  await expect(page.getByRole('textbox', { name: 'Campaign name' })).toHaveValue('big-2000');
  await page.getByRole('button', { name: 'Open Zone 3' }).click();
  await mapReady(page);
  await openSettings(page);
  await expect(page.getByRole('textbox', { name: 'Campaign name' })).toHaveValue('Zone 3');

  await page.getByRole('button', { name: 'Delete this campaign' }).click();
  await expect(page.getByText('Delete Zone 3?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Delete this campaign' }).click();
  await page.getByRole('button', { name: 'Delete campaign' }).click();
  await expect(page.getByRole('textbox', { name: 'Campaign name' })).toHaveValue('big-2000');
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete this campaign' }).click();
  await page.getByRole('button', { name: 'Delete campaign' }).click();
  await expect(
    page.getByText('Import a KMZ export from My Maps to start a campaign.'),
  ).toBeVisible();
});

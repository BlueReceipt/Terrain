import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
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

/** Settings from the map, by its button's name in the screen's language. */
async function openSettingsIn(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
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

test('About names who made Terrain, its license and code, and where to write', async ({ page }) => {
  await openSettings(page);
  const about = page.getByRole('region', { name: 'About' });
  await expect(about).toContainText('Designed by Alex Ederer, with help from Claude by Anthropic.');
  await expect(about).toContainText('Open source, under the MIT License:');
  await expect(about.getByRole('link', { name: 'github.com/BlueReceipt/Terrain' })).toHaveAttribute(
    'href',
    'https://github.com/BlueReceipt/Terrain',
  );
  await expect(about.getByRole('link', { name: 'alex@ederer.digital' })).toHaveAttribute(
    'href',
    'mailto:alex@ederer.digital',
  );
});

test('Français switches every screen to French, stays after a reload, and the export stays English', async ({
  page,
}) => {
  // Files go to Downloads, not to Windows' share sheet.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
  });
  await openSettings(page);
  await page.getByRole('radio', { name: 'Français' }).check();
  await expect(page.getByRole('heading', { name: 'Paramètres', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('region', { name: 'À propos' })).toContainText(
    'Conçu par Alex Ederer, avec l’aide de Claude d’Anthropic.',
  );

  // The map and the card, in French; the status names are Alex's, as he set them.
  await page.getByRole('button', { name: '← Carte' }).click();
  await mapReady(page);
  await expect(page.getByRole('button', { name: 'Journal du jour' })).toBeVisible();
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await expect(card.getByText('3 fiches')).toBeVisible();
  await card
    .getByRole('group', { name: 'Marquer la maison' })
    .getByRole('button', { name: 'Given' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Given : 3 fiches au 123, rue Saint-Paul' }),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Fermer', exact: true }).click();

  // The choice is kept.
  await page.reload();
  await mapReady(page);
  await expect(page.getByRole('button', { name: 'Journal du jour' })).toBeVisible();

  // The client's files stay in English: the Journal, as its template has it.
  await page.getByRole('button', { name: 'Journal du jour' }).click();
  await expect(page.getByRole('list', { name: 'La journée en chiffres' })).toContainText(
    'Given : 3 fiches',
  );
  await page.getByRole('button', { name: 'Exporter', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exporter l’Excel' }).click(),
  ]);
  const book = XLSX.read(await readFile(await download.path()), { type: 'buffer' });
  expect(book.SheetNames).toEqual(['Parcels', 'Journal']);
  const sheet = book.Sheets.Journal;
  if (!sheet) throw new Error('No Journal');
  const journal = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
  expect(journal[0]).toEqual([
    'Date',
    'Time',
    'Parcel ID',
    'Owner',
    'Address',
    'Action',
    'Detail',
    'Previous value',
    'New value',
  ]);
  expect(journal[1]?.[5]).toBe('Status');

  // Back to English.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await openSettingsIn(page, 'Paramètres');
  await page.getByRole('radio', { name: 'English' }).check();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
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
  await page.getByRole('combobox', { name: 'Group entries into lots by' }).selectOption('NUM_LOT');
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
    page.getByText('Import the client’s Excel, or a KMZ export from My Maps, to start a campaign.'),
  ).toBeVisible();
});

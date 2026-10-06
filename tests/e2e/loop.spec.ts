import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import {
  closeCard,
  mapReady,
  mark,
  offlineAfterFirstLoad,
  openCases,
  openHouse,
  storedRow,
} from './helpers.ts';

// Offline: the whole loop of a day at the door, and a phone that
// dies mid-day losing nothing it confirmed.
const TREMPETTE = [-73.6105, 45.2641] as const;
const RUE_SAINT_PAUL = '123, rue Saint-Paul';
const at = (time: string) => new Date(`2026-09-26T${time}:00-04:00`);

test.use({ timezoneId: 'America/Toronto' });

test.beforeEach(async ({ page }) => {
  // Stand-ins for the dialer and for Windows' share sheet (files go to Downloads).
  await page.addInitScript(() => {
    window.dialed = [];
    window.terrainDial = (url) => {
      window.dialed?.push(url);
    };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
  });
  await page.clock.setFixedTime(at('14:28'));
  await offlineAfterFirstLoad(page);
  await openCases(page);
});

function sheetOf(book: XLSX.WorkBook, name: string): string[][] {
  const sheet = book.Sheets[name];
  if (!sheet) throw new Error(`No sheet ${name}`);
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
}

async function editMariesCell(page: Page) {
  const form = page.getByRole('dialog', { name: `Edit info: ${RUE_SAINT_PAUL}` });
  await form
    .locator('fieldset', { has: page.locator('legend', { hasText: 'Marie Trempette' }) })
    .getByLabel('CELLULAIRE')
    .fill('514 555-0100');
  return form;
}

test('the whole loop of a day, offline, ends in an Excel file holding all of it', async ({
  page,
}) => {
  // Tap a house, see every row there.
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await expect(card.locator('.card-owners > li')).toHaveCount(3);

  // Correct a field: Marie's cell.
  await card.getByRole('button', { name: 'Show everything' }).click();
  await card.getByRole('button', { name: 'Edit info' }).click();
  const form = await editMariesCell(page);
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Info updated: 1 entry' })).toBeVisible();

  // Given: every row at the house.
  await page.clock.setFixedTime(at('14:32'));
  await mark(card, 'Given');

  // Call Marie on her corrected cell and log the outcome.
  await page.clock.setFixedTime(at('14:35'));
  await card.getByRole('button', { name: 'Call', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Which number?' })
    .getByRole('button', { name: /^Marie Trempette, cell 514 555-0100$/ })
    .click();
  // The call is saved before the dialer opens: wait for it.
  await expect.poll(() => page.evaluate(() => window.dialed)).toEqual(['tel:5145550100']);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page
    .getByRole('dialog', { name: 'How did the call to 514 555-0100 go?' })
    .getByRole('button', { name: 'Voicemail' })
    .click();

  // A note for the house.
  await page.clock.setFixedTime(at('14:40'));
  await card.getByRole('button', { name: 'Note', exact: true }).click();
  const editor = page.getByRole('dialog', { name: `Note for 3 entries at ${RUE_SAINT_PAUL}` });
  await editor.getByRole('textbox').fill('Cantine Alain, confirmer avec Alain');
  await editor.getByRole('button', { name: 'Save note' }).click();
  await closeCard(card);

  // All of it in the day log; the call between Given and the note keeps them on lines of their own.
  await page.getByRole('button', { name: 'Day log' }).click();
  const log = page.getByRole('dialog', { name: 'Day log' });
  await expect(log.locator('.log-line')).toHaveText([
    /^14:28\s*123, rue Saint-Paul info updated: CELLULAIRE \(Marie Trempette\)$/,
    /^14:32\s*Given\s*123, rue Saint-Paul\s*P1-216B/,
    /^14:35\s*123, rue Saint-Paul call 514 555-0100: Voicemail \(Marie Trempette\)$/,
    /^14:40\s*123, rue Saint-Paul note: Cantine Alain, confirmer avec Alain$/,
  ]);
  await expect(log.locator('.log-line .swatch')).toHaveCount(1);

  // Export Excel: the client's rows carry it all, and the Journal lists every action.
  await log.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Excel' }).click(),
  ]);
  const book = XLSX.read(await readFile(await download.path()), { type: 'buffer' });
  const [header = [], ...rows] = sheetOf(book, 'Parcels');
  const cell = (row: readonly string[], column: string) => row[header.indexOf(column)] ?? '';
  const marie = rows.find(
    (row) => cell(row, 'PRENOM') === 'Marie' && cell(row, 'NOM') === 'Trempette',
  );
  if (!marie) throw new Error('No row for Marie');
  expect(
    ['CELLULAIRE', 'Package status', 'Visit date', 'Call date', 'call result', 'Notes'].map(
      (column) => cell(marie, column),
    ),
  ).toEqual([
    '514 555-0100',
    'Given',
    '26.09.2026 14:32',
    '26.09.2026 14:35',
    'Voicemail',
    '26.09.2026 14:40 - Cantine Alain, confirmer avec Alain',
  ]);
  const actions = sheetOf(book, 'Journal')
    .slice(1)
    .map((line) => line[5]);
  expect(actions).toEqual([
    'Field edited',
    'Status',
    'Status',
    'Status',
    'Status via lot',
    'Call',
    'Note',
    'Note',
    'Note',
  ]);
});

test('a phone that dies mid-day keeps every confirmed action and drops an unsaved edit', async ({
  page,
}) => {
  let card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'Given');
  await expect(page.getByRole('status').filter({ hasText: 'Given: 3 entries' })).toBeVisible();

  // Edit info half done, then the app is killed: a reload stands in for it.
  await card.getByRole('button', { name: 'Show everything' }).click();
  await card.getByRole('button', { name: 'Edit info' }).click();
  await editMariesCell(page);
  await page.reload();
  await mapReady(page);

  // The tap whose toast showed is there; the unsaved edit is cleanly gone, never half-saved.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const name of ['Alain', 'Marie'])
    expect(await storedRow(page, 'P1-216B', name)).toMatchObject({ statusId: 'given', edits: {} });
  card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await expect(card.locator('.card-parcels .status-chip')).toHaveText([
    'Given14:28',
    'Given14:28',
    'Given14:28',
  ]);
});

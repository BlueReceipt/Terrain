import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { closeCard, mark, offlineAfterFirstLoad, openCases, openHouse } from './helpers.ts';

// BUILD_SPEC Phase 5: the day log and the exports, offline, clock at 2026-09-26 14:32.
const TREMPETTE = [-73.6105, 45.2641] as const;
const RUE_SAINT_PAUL = '123, rue Saint-Paul';

test.use({ timezoneId: 'America/Toronto', permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  // The test browser would open Windows' share sheet: here files go to Downloads, unless a test
  // gives the page a share sheet of its own.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
  });
  await page.clock.setFixedTime(new Date('2026-09-26T14:32:00-04:00'));
  await offlineAfterFirstLoad(page);
  await openCases(page);
});

/** A day's work at the Trempettes': Given (Luc's row closed from the lot), then a house note. */
async function work(page: Page) {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'Given');
  await page.clock.setFixedTime(new Date('2026-09-26T14:40:00-04:00'));
  await card.getByRole('button', { name: 'Note', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Note for 3 rows at 123, rue Saint-Paul' });
  await editor.getByRole('textbox').fill('Cantine Alain, confirmer avec Alain');
  await editor.getByRole('button', { name: 'Save note' }).click();
  await closeCard(card);
}

async function openDayLog(page: Page) {
  await page.getByRole('button', { name: 'Day log' }).click();
  const log = page.getByRole('dialog', { name: 'Day log' });
  await expect(log).toBeVisible();
  return log;
}

/** A downloaded file's bytes. */
async function downloaded(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: await readFile(path) };
}

test('the day log counts the day, lists each action by house, copies as text and opens a house', async ({
  page,
}) => {
  await work(page);
  const log = await openDayLog(page);
  await expect(log.getByRole('list', { name: 'The day in numbers' })).toHaveText(
    /Given: 3 rows\s*\+1 via lot\s*Notes: 1/,
  );
  await expect(log.locator('.log-line')).toHaveText([
    /^14:32\s*123, rue Saint-Paul Given\s*P1-216B \(2 rows\), P1-217A\s*also closed 12, chemin du Lac \(Luc Trempette, P1-216B\)$/,
    /^14:40\s*123, rue Saint-Paul note: Cantine Alain, confirmer avec Alain$/,
  ]);
  await expect(log).toContainText('2 changes not exported yet');
  // One day of work: nothing before it or after it to step to.
  await expect(log.getByRole('button', { name: 'Previous day with work' })).toBeDisabled();
  await expect(log.getByRole('button', { name: 'Next day with work' })).toBeDisabled();

  await log.getByRole('button', { name: 'Copy as text' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Day log copied.' })).toBeVisible();
  // Windows' clipboard ends lines in CRLF; the phone's doesn't.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, '\n')).toBe(
    [
      'Terrain, cases, 26.09.2026',
      'Given: 3 rows (+1 via lot) · Notes: 1',
      '',
      '14:32  123, rue Saint-Paul  Given',
      '       P1-216B (2 rows), P1-217A',
      '       also closed 12, chemin du Lac (Luc Trempette, P1-216B)',
      '14:40  123, rue Saint-Paul  note: Cantine Alain, confirmer avec Alain',
    ].join('\n'),
  );

  // Another day: nothing yet.
  await log.getByRole('textbox', { name: 'Day' }).fill('2026-09-27');
  await expect(log).toContainText('Nothing recorded this day.');
  await log.getByRole('button', { name: 'Previous day with work' }).click();
  await expect(log.locator('.log-line')).toHaveCount(2);

  // A line opens its house.
  await log.locator('.log-line').first().click();
  await expect(log).toBeHidden();
  await expect(page.getByRole('region', { name: RUE_SAINT_PAUL })).toBeVisible();
});

test('Excel for the client, offline: Parcels and Journal, and the counter goes to zero', async ({
  page,
}) => {
  await work(page);
  const log = await openDayLog(page);
  await log.getByRole('button', { name: 'Export' }).click();
  const exports = page.getByRole('dialog', { name: 'Export' });
  await expect(exports).toContainText('2 changes not exported yet');

  const file = await downloaded(page, () =>
    exports.getByRole('button', { name: 'Export Excel' }).click(),
  );
  expect(file.name).toBe('Terrain_cases_2026-09-26.xlsx');
  const book = XLSX.read(file.bytes, { type: 'buffer' });
  expect(book.SheetNames).toEqual(['Parcels', 'Journal']);
  const sheet = (name: string) => {
    const page = book.Sheets[name];
    if (!page) throw new Error(`No sheet ${name}`);
    return XLSX.utils.sheet_to_json<string[]>(page, { header: 1, raw: false, defval: '' });
  };
  const [header = [], ...rows] = sheet('Parcels');
  expect(header.slice(0, 4)).toEqual(['Parcel ID', 'Contact person', 'Contact number', 'Notes']);
  const at = (column: string) => header.indexOf(column);
  const trempettes = rows.filter((row) => row[at('ADRESSE')] === RUE_SAINT_PAUL);
  expect(
    trempettes.map((row) => [
      row[0],
      row[at('PRENOM')],
      row[at('Package status')],
      row[at('Visit date')],
      row[at('Notes')],
    ]),
  ).toEqual([
    [
      'P1-216B',
      'Alain',
      'Given',
      '26.09.2026 14:32',
      '26.09.2026 14:40 - Cantine Alain, confirmer avec Alain',
    ],
    [
      'P1-216B',
      'Marie',
      'Given',
      '26.09.2026 14:32',
      '26.09.2026 14:40 - Cantine Alain, confirmer avec Alain',
    ],
    [
      'P1-217A',
      'Alain',
      'Given',
      '26.09.2026 14:32',
      '26.09.2026 14:40 - Cantine Alain, confirmer avec Alain',
    ],
  ]);
  const journal = sheet('Journal');
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
  // Given: 3 rows marked and Luc closed from the lot; the note: 3 rows.
  expect(journal.slice(1).map((line) => [line[1], line[3], line[5]])).toEqual([
    ['14:32', 'Alain Trempette', 'Status'],
    ['14:32', 'Marie Trempette', 'Status'],
    ['14:32', 'Alain Trempette', 'Status'],
    ['14:32', 'Luc Trempette', 'Status via lot'],
    ['14:40', 'Alain Trempette', 'Note'],
    ['14:40', 'Marie Trempette', 'Note'],
    ['14:40', 'Alain Trempette', 'Note'],
  ]);

  await expect(
    page.getByRole('status').filter({ hasText: 'Saved Terrain_cases_2026-09-26.xlsx' }),
  ).toBeVisible();
  await expect(exports).toContainText('Everything is exported.');
});

test('My Maps update: one CSV per layer, with a byte-order mark and its positions', async ({
  page,
}) => {
  await work(page);
  const log = await openDayLog(page);
  await log.getByRole('button', { name: 'Export' }).click();
  const exports = page.getByRole('dialog', { name: 'Export' });
  const layer = exports.getByRole('button', { name: /^Cases layer · \d+ rows$/ });
  const file = await downloaded(page, () => layer.click());
  expect(file.name).toBe('Terrain_cases_Cases layer_2026-09-26.csv');
  const text = file.bytes.toString('utf8');
  expect(text.startsWith('\uFEFFParcel ID,Contact person,')).toBe(true);
  const [header = '', ...lines] = text.slice(1).split('\r\n');
  expect(header.endsWith(',Latitude,Longitude,Location')).toBe(true);
  expect(
    lines.some((line) => line.startsWith('P1-216B,') && line.includes('Saint-Roch-des-Aulnaies')),
  ).toBe(true);
  // The 3 rows marked and Luc's, closed from the lot.
  const trempettes = lines.filter((line) => line.includes(',Trempette,'));
  expect(trempettes).toHaveLength(4);
  for (const line of trempettes) expect(line).toContain(',26.09.2026 14:32,Given,');
});

test('a share sheet, where the phone offers one, takes the file; closing it exports nothing', async ({
  page,
}) => {
  // The phone's share sheet: the first time it is closed without sharing, then it shares.
  await page.evaluate(() => {
    const sheet = { opened: 0, shared: [] as string[] };
    Object.assign(window, { sheet });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: { files?: File[] }) => {
        sheet.opened += 1;
        if (sheet.opened === 1) return Promise.reject(new DOMException('Closed', 'AbortError'));
        sheet.shared.push(...(data.files ?? []).map((file) => file.name));
        return Promise.resolve();
      },
    });
  });
  const shareSheet = () =>
    page.evaluate(
      () => (window as unknown as { sheet: { opened: number; shared: string[] } }).sheet,
    );
  await work(page);
  const log = await openDayLog(page);
  await log.getByRole('button', { name: 'Export' }).click();
  const exports = page.getByRole('dialog', { name: 'Export' });
  const backUp = exports.getByRole('button', { name: 'Back up' });

  await backUp.click();
  await expect.poll(async () => (await shareSheet()).opened).toBe(1);
  await expect(backUp).toBeEnabled();
  await expect(exports).toContainText('2 changes not exported yet');

  await backUp.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Shared Terrain_backup_' }),
  ).toBeVisible();
  expect(await shareSheet()).toEqual({ opened: 2, shared: ['Terrain_backup_2026-09-26.json'] });
  await expect(exports).toContainText('Everything is exported.');
});

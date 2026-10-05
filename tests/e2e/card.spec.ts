import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  closeCard,
  mapReady,
  mark,
  offlineAfterFirstLoad,
  openCases,
  openHouse,
  pins,
  storedRow,
  storedRows,
} from './helpers.ts';

// The house card, offline, clock at 2026-09-26 14:32. At 123 rue Saint-Paul, Alain and
// Marie Trempette on P1-216B and Alain on P1-217A; at 12 chemin du Lac, Luc Trempette on P1-216B.
const TREMPETTE = [-73.6105, 45.2641] as const;
const LUC = [-73.59263, 45.272185] as const;
/** Where the mocked GPS puts the phone. */
const HERE = [-73.61, 45.26455] as const;
const RUE_SAINT_PAUL = '123, rue Saint-Paul';
const DU_LAC = '12, chemin du Lac';
const NOW = new Date('2026-09-26T14:32:00-04:00');
const STAMP = '2026-09-26T14:32:00-04:00';
const GIVEN = '#0F9D58';
const TO_VISIT = '#0288D1';
const TREMBLAY_ROWS = [
  ['P1-216B', 'Alain'],
  ['P1-216B', 'Marie'],
  ['P1-217A', 'Alain'],
] as const;

test.use({
  timezoneId: 'America/Toronto',
  geolocation: { latitude: HERE[1], longitude: HERE[0], accuracy: 8 },
  permissions: ['geolocation'],
});

test.beforeEach(async ({ page }) => {
  // A test browser has no dialer and no motor: stand-ins record the numbers and the taps instead.
  await page.addInitScript(() => {
    window.dialed = [];
    window.terrainDial = (url) => {
      window.dialed?.push(url);
    };
    window.buzzed = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number | number[]) => {
        window.buzzed?.push(pattern);
        return true;
      },
    });
  });
  await page.clock.setFixedTime(NOW);
  await offlineAfterFirstLoad(page);
  await openCases(page);
});

const owner = (card: Locator, name: string) =>
  card.locator('.card-owners > li', { has: card.page().getByRole('button', { name }) });

/** The pin drawn at a place, if any. */
async function pinAt(page: Page, [lng, lat]: readonly [number, number]) {
  return (await pins(page)).find(
    (pin) => Math.abs(pin.lng - lng) < 0.0001 && Math.abs(pin.lat - lat) < 0.0001,
  );
}

async function lucPin(page: Page) {
  const pin = await pinAt(page, LUC);
  if (!pin) throw new Error('No pin at Luc’s house');
  return pin;
}

/** Every cell of a row except the two a status tap writes (Package status and Visit date). */
const otherCells = (row: Record<string, unknown>) => ({
  parcelIdRaw: row.parcelIdRaw,
  sourceFields: row.sourceFields,
  edits: row.edits,
  position: row.position,
  callDate: row.callDate,
  callResult: row.callResult,
  importedNotes: row.importedNotes,
});

test('Given at a house marks its 3 rows, closes Luc’s row with a lot note, and one Undo takes it all back', async ({
  page,
}) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await expect(card.locator('.parcel')).toHaveText(['P1-216B', 'P1-217A']);
  await expect(card.locator('.card-owners > li')).toHaveCount(3);
  await expect(
    card.getByRole('button', {
      name: 'P1-216B also at 12, chemin du Lac: Luc Trempette, to visit',
    }),
  ).toBeVisible();
  const before = await Promise.all(TREMBLAY_ROWS.map(([id, name]) => storedRow(page, id, name)));

  await mark(card, 'Given');
  const toast = page.getByRole('status').filter({ hasText: 'Given: 3 rows' });
  await expect(toast).toHaveText(
    /Given: 3 rows at 123, rue Saint-Paul and 1 row at 12, chemin du Lac/,
  );
  expect(await page.evaluate(() => window.buzzed)).toEqual([12]);
  await expect(card.locator('.card-parcels .status-chip')).toHaveText([
    'Given14:32',
    'Given14:32',
    'Given14:32',
  ]);
  // Only Package status and Visit date change on the rows marked: no other cell.
  for (const [i, [id, name]] of TREMBLAY_ROWS.entries()) {
    const row = await storedRow(page, id, name);
    expect(row).toMatchObject({ statusId: 'given', packageStatusText: 'Given', visitDate: STAMP });
    expect(otherCells(row)).toEqual(otherCells(before[i] ?? {}));
  }
  const luc = await storedRow(page, 'P1-216B', 'Luc');
  expect(luc).toMatchObject({ statusId: 'given', packageStatusText: 'Given', visitDate: STAMP });
  // Both pins recolor: solid at the door, a ring at Luc's, closed from the lot.
  expect(await pinAt(page, TREMPETTE)).toMatchObject({ color: GIVEN, ring: false });
  expect(await lucPin(page)).toMatchObject({ color: GIVEN, ring: true });

  // The toast's Undo, while it shows (6 seconds): all 4 rows back.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () => (await storedRow(page, 'P1-216B', 'Luc')).statusId)
    .toBe('to-visit');
  for (const [id, name] of TREMBLAY_ROWS)
    expect(await storedRow(page, id, name)).toMatchObject({
      statusId: 'to-visit',
      packageStatusText: '',
      visitDate: '',
    });
  await expect.poll(async () => (await lucPin(page)).ring).toBe(false);
  expect(await pinAt(page, TREMPETTE)).toMatchObject({ color: TO_VISIT });

  // Given again: no note on the rows marked; Luc's card carries the lot note, naming both owners,
  // the address and the time.
  await mark(card, 'Given');
  await card.getByRole('button', { name: 'Show everything' }).click();
  await expect(card.getByRole('region', { name: 'Notes' })).toContainText('No notes yet.');
  await closeCard(card);
  const lucCard = await openHouse(page, LUC, DU_LAC);
  await lucCard.getByRole('button', { name: 'Show everything' }).click();
  await expect(lucCard.locator('.note > p:first-child')).toHaveText([
    'Given with Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 26.09.2026 14:32',
  ]);
});

test('At door stays at the house, and one row can differ: To research on Marie opens her note', async ({
  page,
}) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'At door');
  await expect(card.locator('.card-parcels .status-chip')).toHaveText([
    'At door14:32',
    'At door14:32',
    'At door14:32',
  ]);
  expect((await storedRow(page, 'P1-216B', 'Luc')).statusId).toBe('to-visit');

  await owner(card, 'Marie Trempette')
    .getByRole('button', { name: /Marie Trempette/ })
    .click();
  await card
    .getByRole('group', { name: 'This row only' })
    .getByRole('button', { name: 'To research' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Note for Marie Trempette' })).toBeVisible();
  expect((await storedRow(page, 'P1-216B', 'Marie')).statusId).toBe('to-research');
  expect((await storedRow(page, 'P1-216B', 'Alain')).statusId).toBe('at-door');
  expect((await storedRow(page, 'P1-217A', 'Alain')).statusId).toBe('at-door');

  // Luc stays To visit, and his card shows the 3 rows at 123 rue Saint-Paul with their status.
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await closeCard(card);
  const lucCard = await openHouse(page, LUC, DU_LAC);
  await expect(lucCard.locator('.card-parcels .status-chip')).toHaveText(['To visit']);
  await lucCard.getByRole('button', { name: 'Show everything' }).click();
  const lot = lucCard.getByRole('region', { name: 'Same parcel at other addresses' });
  await expect(lot).toContainText('123, rue Saint-Paul');
  await expect(lot.locator('.lot-owner')).toHaveText([
    /^P1-216B Alain Trempette\s*At door14:32$/,
    /^P1-216B Marie Trempette\s*To research14:32$/,
    /^P1-217A Alain Trempette\s*At door14:32$/,
  ]);
});

test('Edit info writes each correction on the rows it belongs to, and Given keeps them', async ({
  page,
}) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await card.getByRole('button', { name: 'Show everything' }).click();
  await card.getByRole('button', { name: 'Edit info' }).click();
  const form = page.getByRole('dialog', { name: 'Edit info: 123, rue Saint-Paul' });
  const section = (title: string) =>
    form.locator('fieldset', { has: page.locator('legend', { hasText: title }) });
  await section('Alain Trempette').getByLabel('TEL_RES').fill('450 555-0111');
  await section('Marie Trempette').getByLabel('CELLULAIRE').fill('514 555-0100');
  await section('Parcel P1-217A').getByLabel('NUM_LOT').fill('1 234 502');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Info updated: 3 rows' })).toBeVisible();

  // A fix goes on one owner only (Alex, 2026-10-01): Alain's home line on his two rows, not Marie's.
  const corrected = [
    { TEL_RES: '450 555-0111' },
    { CELLULAIRE: '514 555-0100' },
    { TEL_RES: '450 555-0111', NUM_LOT: '1 234 502' },
  ];
  for (const [i, [id, name]] of TREMBLAY_ROWS.entries())
    expect((await storedRow(page, id, name)).edits).toEqual(corrected[i]);
  // Alain's home line shows once for his two rows: 3 edited marks.
  await expect(card.locator('.edited-value')).toHaveCount(3);

  await mark(card, 'Given');
  await expect(card.locator('.card-parcels .status-chip')).toHaveText([
    'Given14:32',
    'Given14:32',
    'Given14:32',
  ]);
  for (const [i, [id, name]] of TREMBLAY_ROWS.entries())
    expect(await storedRow(page, id, name)).toMatchObject({
      statusId: 'given',
      packageStatusText: 'Given',
      visitDate: STAMP,
      edits: corrected[i],
    });
});

test('a call to a cell logs on its owner’s row; the home line on every row listing it', async ({
  page,
}) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await card.getByRole('button', { name: 'Call', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Which number?' })
    .getByRole('button', { name: /^Marie Trempette, cell/ })
    .click();
  // The call is saved before the dialer opens: wait for it.
  await expect.poll(() => page.evaluate(() => window.dialed)).toEqual(['tel:5145550199']);
  // Back from the dialer: the app becomes visible again and asks how the call went.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const marie = page.getByRole('dialog', { name: 'How did the call to 514 555-0199 go?' });
  // Closed without an answer, the call waits on the card.
  await marie.getByRole('button', { name: 'Close' }).click();
  await card.getByRole('button', { name: 'Log call outcome: 514 555-0199' }).click();
  await marie.getByRole('button', { name: 'Voicemail' }).click();
  await expect
    .poll(async () => (await storedRow(page, 'P1-216B', 'Marie')).callResult)
    .toBe('Voicemail');
  expect((await storedRow(page, 'P1-216B', 'Marie')).callDate).toBe(STAMP);
  expect((await storedRow(page, 'P1-216B', 'Alain')).callResult).toBe('');
  expect((await storedRow(page, 'P1-217A', 'Alain')).callResult).toBe('');
  await expect(card.getByRole('button', { name: /^Log call outcome/ })).toHaveCount(0);

  await card.getByRole('button', { name: 'Call', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Which number?' })
    .getByRole('button', { name: /^Home/ })
    .click();
  // The call is saved before the dialer opens: wait for it.
  await expect
    .poll(() => page.evaluate(() => window.dialed))
    .toEqual(['tel:5145550199', 'tel:4505550100']);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page
    .getByRole('dialog', { name: 'How did the call to 450 555-0100 go?' })
    .getByRole('button', { name: 'Info good' })
    .click();
  await expect
    .poll(
      async () => (await storedRows(page)).filter((row) => row.callResult === 'Info good').length,
    )
    .toBe(3);

  // Log call, for a number that isn't on file: the whole house, Call date now.
  await page.clock.setFixedTime(new Date('2026-09-26T15:05:00-04:00'));
  await card.getByRole('button', { name: 'Log call', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Which number did you call?' })
    .getByRole('button', { name: 'Another number: the whole house' })
    .click();
  await page
    .getByRole('dialog', { name: 'How did the call go?' })
    .getByRole('button', { name: 'No answer' })
    .click();
  await expect
    .poll(async () =>
      (await storedRows(page))
        .filter((row) => row.callResult === 'No answer')
        .map((row) => row.callDate),
    )
    .toEqual([
      '2026-09-26T15:05:00-04:00',
      '2026-09-26T15:05:00-04:00',
      '2026-09-26T15:05:00-04:00',
    ]);
  expect((await storedRow(page, 'P1-216B', 'Luc')).callResult).toBe('');
});

test('Given elsewhere on the lot keeps Luc’s To research and notes it; it closes an At door', async ({
  page,
}) => {
  let lucCard = await openHouse(page, LUC, DU_LAC);
  await mark(lucCard, 'To research');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await closeCard(lucCard);

  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'Given');
  expect((await storedRow(page, 'P1-216B', 'Luc')).statusId).toBe('to-research');
  await closeCard(card);
  lucCard = await openHouse(page, LUC, DU_LAC);
  await lucCard.getByRole('button', { name: 'Show everything' }).click();
  await expect(lucCard.locator('.note > p:first-child')).toHaveText([
    'Given with Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 26.09.2026 14:32',
  ]);
  await mark(lucCard, 'At door');
  await closeCard(lucCard);

  const again = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  // The house must change status for Given to spread again: a repeat tap changes nothing.
  await mark(again, 'At door');
  await mark(again, 'Given');
  await expect.poll(async () => (await storedRow(page, 'P1-216B', 'Luc')).statusId).toBe('given');
});

test('a direct tap on a house closed from the lot makes it solid and re-stamps Visit date', async ({
  page,
}) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'Given');
  await closeCard(card);
  expect((await lucPin(page)).ring).toBe(true);
  await page.clock.setFixedTime(new Date('2026-09-26T15:10:00-04:00'));
  const lucCard = await openHouse(page, LUC, DU_LAC);
  await mark(lucCard, 'Given');
  await expect.poll(async () => (await lucPin(page)).ring).toBe(false);
  expect((await storedRow(page, 'P1-216B', 'Luc')).visitDate).toBe('2026-09-26T15:10:00-04:00');
});

test('Use my location moves the house and every row; Navigate follows; Undo moves it back', async ({
  page,
}) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  const before = await Promise.all(
    TREMBLAY_ROWS.map(async ([id, name]) => (await storedRow(page, id, name)).position),
  );
  await card.getByRole('button', { name: 'Show everything' }).click();
  await card.getByRole('button', { name: 'Use my location, accurate to 8 m' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'House pinned where you are' });
  await expect(toast).toBeVisible();
  for (const [id, name] of TREMBLAY_ROWS)
    expect((await storedRow(page, id, name)).position).toEqual({ lat: HERE[1], lng: HERE[0] });
  await expect(card.getByRole('link', { name: 'Navigate' })).toHaveAttribute(
    'href',
    /destination=45\.26455,-73\.61$/,
  );
  // The pin, with its 3 rows, redraws where the phone is.
  expect(await pinAt(page, HERE)).toMatchObject({ badge: '3' });
  expect(await pinAt(page, TREMPETTE)).toBeUndefined();

  // Undo puts every row back where it was.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () =>
      Promise.all(
        TREMBLAY_ROWS.map(async ([id, name]) => (await storedRow(page, id, name)).position),
      ),
    )
    .toEqual(before);
  await expect.poll(async () => (await pinAt(page, TREMPETTE))?.badge).toBe('3');
});

test('To research asks for a note for the 3 rows; closing the editor unwritten keeps the status', async ({
  page,
}) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'To research');
  const editor = page.getByRole('dialog', { name: 'Note for 3 rows at 123, rue Saint-Paul' });
  await editor.getByRole('textbox').fill('Chien méchant, sonner deux fois');
  await editor.getByRole('button', { name: 'Save note' }).click();
  await card.getByRole('button', { name: 'Show everything' }).click();
  const notes = card.getByRole('region', { name: 'Notes' });
  await expect(notes.locator('.note > p:first-child')).toHaveText([
    'Chien méchant, sonner deux fois',
  ]);
  await expect(notes.locator('.note > p:last-child')).toHaveText([/All 3 rows$/]);
  await closeCard(card);

  const lucCard = await openHouse(page, LUC, DU_LAC);
  await mark(lucCard, 'To research');
  await page
    .getByRole('dialog', { name: 'Note for 1 row at 12, chemin du Lac' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  expect((await storedRow(page, 'P1-216B', 'Luc')).statusId).toBe('to-research');
  // No note was added: Luc's only note is the one the Trempettes' To research left on the lot.
  await lucCard.getByRole('button', { name: 'Show everything' }).click();
  await expect(lucCard.locator('.note > p:first-child')).toHaveText([
    'Co-owner to research: Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 26.09.2026 14:32',
  ]);
});

test('Mark house as to visit reopens its 3 rows and keeps the last Visit date', async ({
  page,
}) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await mark(card, 'Given');
  await card.getByRole('button', { name: 'Show everything' }).click();
  await card.getByRole('button', { name: 'Mark house as to visit' }).click();
  await expect(card.locator('.card-parcels .status-chip')).toHaveText([
    'To visit14:32',
    'To visit14:32',
    'To visit14:32',
  ]);
  for (const [id, name] of TREMBLAY_ROWS)
    expect(await storedRow(page, id, name)).toMatchObject({
      statusId: 'to-visit',
      packageStatusText: '',
      visitDate: STAMP,
    });
  // Luc's row came from the lot: changing the house afterward leaves it Given.
  expect((await storedRow(page, 'P1-216B', 'Luc')).statusId).toBe('given');
});

test('a house note survives a reload, newest first, on every row', async ({ page }) => {
  let card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  for (const text of ['Cantine Alain', 'Rappeler lundi']) {
    await card.getByRole('button', { name: 'Note', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Note for 3 rows at 123, rue Saint-Paul' });
    await editor.getByRole('textbox').fill(text);
    await editor.getByRole('button', { name: 'Save note' }).click();
  }
  await page.reload();
  await mapReady(page);
  card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await card.getByRole('button', { name: 'Show everything' }).click();
  await expect(card.locator('.note > p:first-child')).toHaveText([
    'Rappeler lundi',
    'Cantine Alain',
  ]);
  await expect(card.locator('.note > p:last-child')).toHaveText([/All 3 rows$/, /All 3 rows$/]);
});

test('every interactive target measures at least 56 px', async ({ page }) => {
  const card = await openHouse(page, TREMPETTE, RUE_SAINT_PAUL);
  await card.getByRole('button', { name: 'Show everything' }).click();
  await owner(card, 'Marie Trempette')
    .getByRole('button', { name: /Marie Trempette/ })
    .click();
  const targets = card.locator('button, a, input, textarea, select, [tabindex="0"]');
  const sizes = await targets.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { text: element.textContent.trim().slice(0, 30), height: box.height };
    }),
  );
  expect(sizes.length).toBeGreaterThan(10);
  expect(sizes.filter((size) => size.height < 55.5)).toEqual([]);
});

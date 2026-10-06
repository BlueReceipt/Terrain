import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  closeCard,
  importFile,
  mapReady,
  mark,
  offlineAfterFirstLoad,
  openHouse,
  openSettings,
} from './helpers.ts';

// Accessibility: WCAG 2.2 AA on every screen, checked by axe.
const TREMPETTE = [-73.6105, 45.2641] as const;

async function problems(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
}

test.use({ timezoneId: 'America/Toronto' });

test('every screen meets WCAG 2.2 AA', async ({ page }) => {
  // Nine axe scans: more than the default 30 s when every worker runs at once.
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date('2026-09-26T14:32:00-04:00'));
  await offlineAfterFirstLoad(page);
  expect(await problems(page), 'home').toEqual([]);

  await importFile(page, 'cases.kmz');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Open campaign' })).toBeVisible();
  expect(await problems(page), 'import report').toEqual([]);
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);
  expect(await problems(page), 'map').toEqual([]);

  const card = await openHouse(page, TREMPETTE, '123, rue Saint-Paul');
  expect(await problems(page), 'card').toEqual([]);
  await mark(card, 'Given');
  await card.getByRole('button', { name: 'Show everything' }).click();
  await card
    .getByRole('button', { name: /Marie Trempette/ })
    .first()
    .click();
  expect(await problems(page), 'full card, a row open, the toast').toEqual([]);

  await card.getByRole('button', { name: 'Call', exact: true }).click();
  expect(await problems(page), 'number chooser').toEqual([]);
  // Escape closes a sheet and gives the focus back.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Call', exact: true })).toBeFocused();

  await card.getByRole('button', { name: 'Edit info' }).click();
  expect(await problems(page), 'Edit info').toEqual([]);
  await page.keyboard.press('Escape');
  await closeCard(card);

  await page.getByRole('button', { name: 'Day log' }).click();
  await expect(page.getByRole('heading', { name: 'Day log' })).toBeFocused();
  expect(await problems(page), 'day log').toEqual([]);
  await page.getByRole('button', { name: 'Export' }).click();
  expect(await problems(page), 'export').toEqual([]);
  // Escape goes back to the day log, which takes the focus; a second Escape closes it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Day log' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openSettings(page);
  await page.getByRole('button', { name: 'Edit Given' }).click();
  expect(await problems(page), 'settings').toEqual([]);
});

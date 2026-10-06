import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { tilesAround } from '../../src/domain/tiles.ts';
import { mapReady, openSettings, pins, swActive } from './helpers.ts';

// The build, reached as Alex's work copy: a relay address with no demo (src/ui/online.ts).
const WORK = 'http://landagentfriend.ederer.digital:4173/';
test.use({
  launchOptions: {
    args: [
      '--host-resolver-rules=MAP landagentfriend.ederer.digital localhost',
      '--unsafely-treat-insecure-origin-as-secure=http://landagentfriend.ederer.digital:4173',
    ],
  },
});

// A client's file without coordinates. Everything but the address is a secret the test looks for.
const SECRETS = [
  'Trempette',
  'Sentinelle',
  'Grains',
  'Secrète',
  'Poutini',
  'Cachée',
  'P9-00',
  '555-019',
  'sentinelle@example.com',
  'SECRET-NOTE',
  'À vérifier',
];
const FILE = [
  'Parcel ID,NOM,PRENOM,ADRESSE,MUNICIPALITE,PROVINCE,CODE_POSTAL,TEL_RES,COURRIEL,Package status,Visit date,Call date,call result,Notes',
  'P9-001,Trempette,Sentinelle,"780, rue Saint-Jean",Québec,QC,G1R 1P8,450 555-0191,sentinelle@example.com,À vérifier,,,,SECRET-NOTE-1',
  'P9-002,Grains,Secrète,"12, chemin du Lac",Saint-Hyacinthe,QC,,450 555-0192,,,,,,SECRET-NOTE-2',
  'P9-003,Poutini,Cachée,"99, rang Inventé",Saint-Hyacinthe,QC,,450 555-0193,,,,,,SECRET-NOTE-3',
].join('\n');

const FIELDS = ['postalCode', 'province', 'street', 'town'];

/** The relay standing in for Adresses Québec: the first house, the second's street, not the third. */
async function relayFinds(page: Page, answer: 'found' | 'down' = 'found'): Promise<unknown[][]> {
  const asked: unknown[][] = [];
  await page.context().route('**/geocode', async (route) => {
    const body = route.request().postDataJSON() as { addresses: { street: string }[] };
    asked.push(body.addresses);
    if (answer === 'down') return route.fulfill({ status: 502, json: { error: 'unreachable' } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({
      json: {
        results: body.addresses.map(({ street }) =>
          street.startsWith('780')
            ? [
                {
                  lat: 46.8113,
                  lng: -71.2176,
                  number: '780',
                  street: 'Rue Saint-Jean',
                  town: 'Québec',
                  postalCode: 'G1R1P9',
                },
              ]
            : street.startsWith('12')
              ? [
                  {
                    lat: 45.6307,
                    lng: -72.9567,
                    number: '',
                    street: 'Chemin du Lac',
                    town: 'Saint-Hyacinthe',
                    postalCode: '',
                  },
                ]
              : [],
        ),
      },
    });
  });
  await page.context().route('**/tiles/**', (route) => route.fulfill({ status: 204 }));
  return asked;
}

/** Every request the page makes, with what it carries. */
function everyRequest(page: Page): { url: string; body: string }[] {
  const seen: { url: string; body: string }[] = [];
  page.on('request', (request: Request) => {
    seen.push({ url: request.url(), body: request.postData() ?? '' });
  });
  return seen;
}

async function importClientFile(page: Page): Promise<void> {
  await page
    .locator('input[type=file][accept*=".csv"]')
    .first()
    .setInputFiles({
      name: 'Cantines client.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(FILE),
    });
}

async function problems(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
}

test('the work copy finds houses from their address, and nothing but the address goes out', async ({
  page,
}) => {
  const asked = await relayFinds(page);
  const requests = everyRequest(page);
  await page.goto(WORK);
  await importClientFile(page);

  await expect(page.getByText('Finding 3 houses from their address…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Import report' })).toBeVisible();
  await expect(page.getByText('Houses found at their address')).toBeVisible();
  const onStreet = page.locator('summary', { hasText: 'Houses found on their street only' });
  await expect(onStreet).toContainText('1');
  await expect(page.locator('summary', { hasText: 'Houses with no position yet' })).toContainText(
    '1',
  );
  await expect(page.getByText(/Adresses Québec \(Gouvernement du Québec/)).toBeVisible();
  expect(await problems(page)).toEqual([]);
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);
  expect((await pins(page)).reduce((houses, pin) => houses + pin.houses, 0)).toBe(2);

  await page.getByRole('button', { name: '1 house on the street only' }).click();
  await page
    .getByRole('region', { name: 'Houses found on their street only' })
    .getByRole('button', { name: /12, chemin du Lac/ })
    .click();
  await expect(page.getByText(/Found on the street only, from the address/)).toBeVisible();

  // What went out: three addresses, each its four fields, and no secret anywhere.
  expect(asked).toEqual([
    [
      { street: '780, rue Saint-Jean', town: 'Québec', postalCode: 'G1R 1P8', province: 'QC' },
      { street: '12, chemin du Lac', town: 'Saint-Hyacinthe', postalCode: '', province: 'QC' },
      { street: '99, rang Inventé', town: 'Saint-Hyacinthe', postalCode: '', province: 'QC' },
    ],
  ]);
  for (const list of asked)
    for (const address of list) expect(Object.keys(address as object).sort()).toEqual(FIELDS);
  const origin = new URL(WORK).origin;
  for (const { url, body } of requests) {
    expect(
      new URL(url).origin === origin || url.startsWith('data:') || url.startsWith('blob:'),
    ).toBe(true);
    for (const secret of SECRETS) {
      expect(decodeURIComponent(url)).not.toContain(secret);
      expect(body).not.toContain(secret);
    }
  }
  // The map's streets come through the relay too.
  expect(requests.some(({ url }) => new URL(url).pathname.startsWith('/tiles/'))).toBe(true);
});

test('without a connection to Adresses Québec, the houses wait; with both switches off, nothing goes online', async ({
  page,
}) => {
  const asked = await relayFinds(page, 'down');
  const requests = everyRequest(page);
  await page.goto(WORK);
  await importClientFile(page);
  await expect(page.getByText(/The address service couldn’t be reached/)).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Houses with no position yet' })).toContainText(
    '3',
  );
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);
  expect(asked).toHaveLength(1);

  await openSettings(page);
  await expect(page.getByRole('heading', { name: 'Online' })).toBeVisible();
  expect(await problems(page)).toEqual([]);
  await page.getByRole('checkbox', { name: 'Find houses from their address' }).uncheck();
  await page.getByRole('checkbox', { name: 'Map from the internet' }).uncheck();
  await page.getByRole('button', { name: 'Map' }).first().click();
  await mapReady(page);
  await expect(
    page.getByRole('button', { name: 'No offline map loaded. Add one in Settings.' }),
  ).toBeVisible();
  const sources = await page.evaluate(() =>
    Object.keys(window.terrainMap?.getStyle().sources ?? {}),
  );
  expect(sources).not.toContain('openfreemap');

  const before = requests.length;
  await openSettings(page);
  await page
    .locator('input[type=file][accept*=".csv"]')
    .first()
    .setInputFiles({
      name: 'Cantines client.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(FILE),
    });
  await expect(page.getByRole('heading', { name: 'Import report' })).toBeVisible();
  expect(asked).toHaveLength(1);
  const later = requests.slice(before).map(({ url }) => new URL(url).pathname);
  expect(later.filter((path) => path === '/geocode' || path.startsWith('/tiles/'))).toEqual([]);
});

test('the work copy keeps the map around its houses for no signal, and draws it from there offline', async ({
  page,
}) => {
  await relayFinds(page);
  await page.goto(WORK);
  await swActive(page);
  await importClientFile(page);
  await page.getByRole('button', { name: 'Open campaign' }).click();
  await mapReady(page);

  // The two houses found: Snack-bar St-Jean's street in Québec, the chemin du Lac.
  const expected = tilesAround([
    { lat: 46.8113, lng: -71.2176 },
    { lat: 45.6307, lng: -72.9567 },
  ]).length;
  const kept = () =>
    page.evaluate(async () => (await (await caches.open('terrain-tiles')).keys()).length);
  await expect.poll(kept, { timeout: 20_000 }).toBeGreaterThanOrEqual(expected);
  await openSettings(page);
  await expect(
    page.getByText(
      `The map around every house is kept for no signal (${String(expected)} pieces).`,
    ),
  ).toBeVisible();

  // No signal: the map draws the tiles the phone kept.
  await page.context().unroute('**/tiles/**');
  await page.context().setOffline(true);
  const fromThePhone: string[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/tiles/') && response.fromServiceWorker())
      fromThePhone.push(response.url());
  });
  await page.reload();
  await mapReady(page);
  await expect.poll(() => fromThePhone.length).toBeGreaterThan(0);
});

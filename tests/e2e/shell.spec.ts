import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices, expect, test, type Page } from '@playwright/test';
import { swActive } from './helpers.ts';

const HOME_SENTENCE =
  'Import the client’s Excel, or a KMZ export from My Maps, to start a campaign.';

async function expectShell(page: Page): Promise<void> {
  await expect(page.getByText(HOME_SENTENCE)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import file' })).toBeVisible();
}

// The deploy: Cloudflare serves the build with dist/_headers. Its policy is the page's own, the
// page itself is never edited on the way (no injected analytics), and the service worker is never
// cached, so an update always reaches the phone.
test('the deploy headers carry the page’s security policy', async ({ page }) => {
  await page.goto('/');
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("connect-src 'self'");
  const headers = await readFile(join(import.meta.dirname, '..', '..', 'dist', '_headers'), 'utf8');
  expect(headers).toContain(`Content-Security-Policy: ${policy ?? ''}; frame-ancestors 'none'`);
  expect(headers).toMatch(/^\/\n {2}Cache-Control: no-cache, no-transform$/m);
  expect(headers).toMatch(/^\/sw\.js\n {2}Cache-Control: no-cache$/m);
  expect(headers).toMatch(
    /^\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m,
  );
});

// The production build installs as an app, reloads with the
// network offline showing the shell, and no request leaves the origin.
test('installs, works offline and never leaves its origin', async ({ baseURL, channel }) => {
  if (!baseURL) {
    throw new Error('baseURL is not set in playwright.config.ts');
  }
  const origin = new URL(baseURL).origin;
  const phone = devices['Pixel 7'];

  // A persistent profile: Chromium refuses to install apps from throwaway (incognito) contexts.
  const profile = await mkdtemp(join(tmpdir(), 'terrain-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    ...(channel ? { channel } : {}),
    baseURL,
    viewport: phone.viewport,
    userAgent: phone.userAgent,
    deviceScaleFactor: phone.deviceScaleFactor,
    isMobile: phone.isMobile,
    hasTouch: phone.hasTouch,
    serviceWorkers: 'allow',
  });

  const requests: string[] = [];
  const problems: string[] = [];
  context.on('request', (request) => requests.push(request.url()));

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto('/');
    await expectShell(page);

    // The service worker is active, which means the app shell is fully precached.
    await swActive(page);

    // Chromium's own install check: an empty list means the browser offers to install the app.
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);

    // Network off: the shell still loads, font included, and so does any in-app address.
    await context.setOffline(true);
    await page.reload();
    await expectShell(page);
    const fontStatuses = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts]
        .filter((face) => face.family.includes('Atkinson Hyperlegible Next'))
        .map((face) => face.status);
    });
    expect(fontStatuses).toContain('loaded');

    await page.goto('/any/deep/link');
    await expectShell(page);

    // Console errors include Content-Security-Policy violations.
    expect(problems).toEqual([]);
    const outside = requests.filter((url) => {
      const parsed = new URL(url);
      return !['data:', 'blob:'].includes(parsed.protocol) && parsed.origin !== origin;
    });
    expect(outside).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

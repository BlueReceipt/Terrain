import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const inCI = Boolean(process.env.CI);

// Playwright's bundled Chromium won't start on Alex's PC: Windows can't load its side-by-side
// manifest from the ms-playwright folder. Local runs use the installed Google Chrome instead,
// with a throwaway profile. Both are full Chromium builds, which the PWA install checks need.
const channel = inCI ? 'chromium' : 'chrome';

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: inCI,
  retries: inCI ? 1 : 0,
  reporter: inCI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], channel },
    },
  ],
  webServer: {
    // e2e always runs against a fresh production build: the service worker only exists there.
    command: 'npm run build && npm run preview',
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !inCI,
    timeout: 180_000,
  },
});

// BUILD_SPEC §6.3: the logic lives in pure functions in src/domain/.
// Time, IDs and randomness come in as parameters (like `now` in planStatusChange).

const CLOCK =
  'src/domain is pure: take the time as a parameter (like `now`) instead of reading the clock.';
const RANDOM = 'src/domain is pure: take IDs and random values as parameters.';
const BROWSER =
  'src/domain is pure: no browser, storage or timer APIs. Use them in src/data, src/map or src/ui and pass the result in.';

const BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'crypto',
  'performance',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
];

/** @type {import('eslint').Linter.Config} */
export const domainPurity = {
  name: 'terrain/domain-purity',
  files: ['src/domain/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '**/data',
              '**/data/**',
              '**/map',
              '**/map/**',
              '**/ui',
              '**/ui/**',
              '**/app',
              '**/app.tsx',
              '**/main',
              '**/main.tsx',
              '**/pwa',
              '**/pwa.ts',
              '**/sw',
              '**/sw.ts',
            ],
            message: 'src/domain is pure: it may not import app, data, map or ui code.',
          },
          {
            group: [
              'dexie',
              'dexie/**',
              'maplibre-gl',
              'maplibre-gl/**',
              'pmtiles',
              '@protomaps/**',
              'preact',
              'preact/**',
              '@preact/**',
              'workbox-*',
              'virtual:*',
            ],
            message: 'src/domain is pure: no database, map, UI or service-worker libraries.',
          },
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      ...BROWSER_GLOBALS.map((name) => ({ name, message: BROWSER })),
    ],
    'no-restricted-properties': [
      'error',
      { object: 'Date', property: 'now', message: CLOCK },
      { object: 'Math', property: 'random', message: RANDOM },
      { object: 'globalThis', message: BROWSER },
    ],
    'no-restricted-syntax': [
      'error',
      { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK },
      { selector: "CallExpression[callee.name='Date']", message: CLOCK },
    ],
  },
};

import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The app makes zero runtime network requests beyond its own origin.
// blob: workers are for MapLibre.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

// Cloudflare Pages: the same policy as an HTTP header, which also covers what a meta tag
// can't (frame-ancestors), a few more locks, and caching that lets an update reach the phone: the
// page, the service worker and the manifest are always revalidated, hashed assets kept a year.
function cloudflareHeaders(): Plugin {
  const rules: Record<string, string[]> = {
    '/*': [
      `Content-Security-Policy: ${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`,
      'X-Content-Type-Options: nosniff',
      'Referrer-Policy: no-referrer',
      'Permissions-Policy: camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
      'Cross-Origin-Opener-Policy: same-origin',
    ],
    '/': ['Cache-Control: no-cache'],
    '/index.html': ['Cache-Control: no-cache'],
    '/sw.js': ['Cache-Control: no-cache'],
    '/manifest.webmanifest': ['Cache-Control: no-cache'],
    '/assets/*': ['Cache-Control: public, max-age=31536000, immutable'],
  };
  return {
    name: 'terrain:cloudflare-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: Object.entries(rules)
          .map(([path, headers]) => [path, ...headers.map((header) => `  ${header}`)].join('\n'))
          .join('\n')
          .concat('\n'),
      });
    },
  };
}

// Settings → About: the version in package.json and the day of the build.
const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const today = new Date();
const BUILT = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
  .map((part) => String(part).padStart(2, '0'))
  .join('-');

// Vite's dev server relies on inline styles and a websocket, so the policy only ships in builds.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'terrain:content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

export default defineConfig({
  define: {
    __TERRAIN_VERSION__: JSON.stringify(version),
    __TERRAIN_BUILT__: JSON.stringify(BUILT),
  },
  plugins: [
    preact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Terrain',
        short_name: 'Terrain',
        description: 'The land agent friend: an offline field book for land-contact campaigns.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FFFFFF',
        theme_color: '#000000',
        icons: [
          { src: '/icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // .pbf: the map's label glyphs. MapLibre and its worker are over Workbox's 2 MB default.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest,pbf}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
    contentSecurityPolicy(),
    cloudflareHeaders(),
  ],
  // MapLibre's worker is an ES module (maplibre-gl 6).
  worker: { format: 'es' },
  // MapLibre is one 1 MB chunk (285 kB gzipped), loaded only when the map shows and precached.
  build: { chunkSizeWarningLimit: 1100 },
  preview: {
    port: 4173,
    strictPort: true,
  },
});

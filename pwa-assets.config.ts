import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// `npm run icons` regenerates the PNG icons next to public/icons/icon.svg.
// The icon is full-bleed black, so padding around it must be black too.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#000000' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#000000' } },
  },
  images: ['public/icons/icon.svg'],
});

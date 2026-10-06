import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { ONLINE, onlineLayers } from './onlineLayers.ts';

export const FONT_REGULAR = 'Atkinson Hyperlegible Next Regular';
export const FONT_BOLD = 'Atkinson Hyperlegible Next Bold';
/** Behind the pins when no offline map is loaded. */
const PLAIN = '#F1F1EE';

/** A color's gray of the same lightness (Rec. 709 luma). */
export function gray(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? '0', 16));
  const level = Math.round(0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0));
  const channel = level.toString(16).padStart(2, '0');
  return `#${channel}${channel}${channel}`;
}

function desaturated<T>(value: T): T {
  if (typeof value === 'string') return gray(value) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, desaturated(inner)]),
    ) as T;
  return value;
}

/** Basemap symbol layers without their icons: Terrain ships no sprite, the pins own the map's color. */
function withoutIcons(layer: LayerSpecification): LayerSpecification {
  if (layer.type !== 'symbol' || !layer.layout) return layer;
  const layout = Object.fromEntries(
    Object.entries(layer.layout).filter(([key]) => !key.startsWith('icon-')),
  );
  return { ...layer, layout };
}

/**
 * The map's style: Protomaps' light flavor, desaturated so the pins own the color, with
 * labels in French in the app's font. Without an offline map: on the public demo (`online`), the
 * same look drawn from OpenFreeMap's tiles through the demo's relay, plain while offline; anywhere
 * else, a plain background under the pins.
 */
export function mapStyle(
  basemapUrl: string | null,
  origin: string,
  online = false,
): StyleSpecification {
  const glyphs = `${origin}/map-assets/glyphs/{fontstack}/{range}.pbf`;
  const flavor: Flavor = {
    ...desaturated(namedFlavor('light')),
    regular: FONT_REGULAR,
    bold: FONT_BOLD,
    italic: FONT_REGULAR,
  };
  if (!basemapUrl && online) {
    return {
      version: 8,
      glyphs,
      sources: {
        [ONLINE]: {
          type: 'vector',
          tiles: [`${origin}/tiles/{z}/{x}/{y}.pbf`],
          maxzoom: 14,
          attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
        },
      },
      layers: onlineLayers(flavor, FONT_REGULAR, FONT_BOLD),
    };
  }
  if (!basemapUrl) {
    return {
      version: 8,
      glyphs,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': PLAIN } }],
    };
  }
  const base = layers('protomaps', flavor, { lang: 'fr' })
    .filter((layer) => layer.id !== 'pois')
    .map(withoutIcons);
  return {
    version: 8,
    glyphs,
    sources: {
      protomaps: { type: 'vector', url: basemapUrl, attribution: '© OpenStreetMap' },
    },
    layers: base,
  };
}

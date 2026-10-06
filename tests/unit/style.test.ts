import { describe, expect, it } from 'vitest';
import { ONLINE } from '../../src/map/onlineLayers.ts';
import { FONT_BOLD, FONT_REGULAR, mapStyle } from '../../src/map/style.ts';

const ORIGIN = 'https://terrain.ederer.digital';

// OpenFreeMap's vector layers (its index at https://tiles.openfreemap.org/planet).
const OPENFREEMAP_LAYERS = [
  'aerodrome_label',
  'aeroway',
  'boundary',
  'building',
  'housenumber',
  'landcover',
  'landuse',
  'mountain_peak',
  'park',
  'place',
  'poi',
  'transportation',
  'transportation_name',
  'water',
  'water_name',
  'waterway',
];

/** Every string anywhere in a value: colors, fonts, expressions. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the map style', () => {
  it('on the demo without an offline map, draws OpenFreeMap’s tiles from its own address', () => {
    const style = mapStyle(null, ORIGIN, true);
    expect(Object.keys(style.sources)).toEqual([ONLINE]);
    expect(style.sources[ONLINE]).toMatchObject({
      type: 'vector',
      tiles: [`${ORIGIN}/tiles/{z}/{x}/{y}.pbf`],
      maxzoom: 14,
      attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
    });
    expect(style.glyphs).toBe(`${ORIGIN}/map-assets/glyphs/{fontstack}/{range}.pbf`);
    expect(style.sprite).toBeUndefined();
    for (const layer of style.layers)
      if ('source-layer' in layer) expect(OPENFREEMAP_LAYERS).toContain(layer['source-layer']);
  });

  it('keeps the online map gray, in the app’s two fonts, its names in French first', () => {
    const style = mapStyle(null, ORIGIN, true);
    const colors = strings(style.layers.map((layer) => layer.paint ?? {})).filter((text) =>
      text.startsWith('#'),
    );
    expect(colors.length).toBeGreaterThan(10);
    for (const color of colors) expect(color).toMatch(/^#([0-9a-f]{2})\1\1$/i);
    const fonts = style.layers.flatMap((layer) =>
      layer.type === 'symbol' ? strings(layer.layout?.['text-font']) : [],
    );
    expect(new Set(fonts)).toEqual(new Set([FONT_REGULAR, FONT_BOLD]));
    const towns = style.layers.find((layer) => layer.id === 'towns');
    expect(towns?.type === 'symbol' && towns.layout?.['text-field']).toEqual([
      'coalesce',
      ['get', 'name:fr'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ]);
  });

  it('prefers a loaded offline map, and stays plain anywhere else', () => {
    const offline = mapStyle('pmtiles://map', ORIGIN, true);
    expect(Object.keys(offline.sources)).toEqual(['protomaps']);
    const plain = mapStyle(null, ORIGIN);
    expect(plain.sources).toEqual({});
    expect(plain.layers.map((layer) => layer.type)).toEqual(['background']);
  });
});

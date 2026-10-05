import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PbfReader } from 'pbf';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { afterAll, describe, expect, it } from 'vitest';
import { extract, fileSource, parseBounds } from '../../scripts/make-basemap.ts';
import { GLYPHS_DIR } from '../../scripts/make-glyphs.ts';
import { TEST_BASEMAP, TEST_BOUNDS, testBasemap } from '../../scripts/make-test-basemap.ts';
import { tilesInBounds, writePmtiles } from '../../scripts/pmtiles.ts';

/** The official reader, over bytes in memory. */
function reader(bytes: Uint8Array): PMTiles {
  // A copy: a Buffer from readFileSync can be a view into a shared pool, and slicing it doesn't copy.
  const own = new Uint8Array(bytes);
  const source: Source = {
    getKey: () => 'memory',
    getBytes: (offset: number, length: number): Promise<RangeResponse> =>
      Promise.resolve({ data: own.slice(offset, offset + length).buffer }),
  };
  return new PMTiles(source);
}

/** Layer names and string values of an MVT tile. */
function tileStrings(bytes: ArrayBuffer): { layers: string[]; strings: string[] } {
  const layers: string[] = [];
  const strings: string[] = [];
  new PbfReader(new Uint8Array(bytes)).readFields((tag, _, pbf) => {
    if (tag !== 3) return;
    pbf.readMessage((field, __, layer) => {
      if (field === 1) layers.push(layer.readString());
      else if (field === 4)
        layer.readMessage((kind, ___, value) => {
          if (kind === 1) strings.push(value.readString());
        }, null);
    }, null);
  }, null);
  return { layers, strings };
}

const work = mkdtempSync(join(tmpdir(), 'terrain-basemap-'));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

// The zoom 13 tile of Saint-Rémi, where the fixtures' Trempette house is.
const [remi] = tilesInBounds([-73.6146, 45.2642, -73.6144, 45.2644], 13);
const SAINT_REMI = { z: 13, x: remi?.x ?? 0, y: remi?.y ?? 0 };

describe('the test basemap (fixtures/public/test-basemap.pmtiles)', () => {
  it('is the committed file, and the official PMTiles reader reads it', async () => {
    const bytes = testBasemap();
    expect(Buffer.compare(Buffer.from(bytes), readFileSync(TEST_BASEMAP))).toBe(0);
    const header = await reader(bytes).getHeader();
    expect(header).toMatchObject({
      specVersion: 3,
      minZoom: 0,
      maxZoom: 13,
      tileType: 1,
      tileCompression: 2,
    });
    expect(header.minLon).toBeCloseTo(TEST_BOUNDS[0]);
    expect(header.maxLat).toBeCloseTo(TEST_BOUNDS[3]);
  });

  it('holds the Protomaps layers, with French place names and their accents', async () => {
    const tile = await reader(testBasemap()).getZxy(SAINT_REMI.z, SAINT_REMI.x, SAINT_REMI.y);
    expect(tile).toBeDefined();
    const { layers, strings } = tileStrings(tile?.data ?? new ArrayBuffer(0));
    expect(layers).toEqual(['earth', 'water', 'roads', 'places']);
    for (const name of ['Saint-Rémi', 'Saint-Édouard', 'Rang Saint-François', 'Lac à la Truite'])
      expect(strings).toContain(name);
  });
});

describe('npm run basemap (scripts/make-basemap.ts)', () => {
  it('reads the area as Terrain copies it, and refuses anything else', () => {
    expect(parseBounds('-73.7,45.2,-73.45,45.33')).toEqual([-73.7, 45.2, -73.45, 45.33]);
    for (const wrong of ['', '-73.7,45.2,-73.45', '-73.45,45.2,-73.7,45.33', 'a,b,c,d'])
      expect(() => parseBounds(wrong)).toThrow('is not an area');
  });

  it('copies the tiles of an area out of an archive, byte for byte', async () => {
    const area = parseBounds('-73.62,45.25,-73.58,45.28');
    const copy = await extract(fileSource(TEST_BASEMAP), area, 13);
    const source = reader(readFileSync(TEST_BASEMAP));
    const extracted = reader(copy);
    expect(await extracted.getHeader()).toMatchObject({ minZoom: 0, maxZoom: 13 });
    for (const { x, y } of tilesInBounds(area, 13)) {
      const original = await source.getZxy(13, x, y);
      const copied = await extracted.getZxy(13, x, y);
      expect(Buffer.from(copied?.data ?? new ArrayBuffer(0))).toEqual(
        Buffer.from(original?.data ?? new ArrayBuffer(1)),
      );
    }
    // Outside the area, nothing.
    expect(await extracted.getZxy(13, 2410, 2928)).toBeUndefined();
  });

  it('stops at the zoom asked for', async () => {
    const copy = await extract(fileSource(TEST_BASEMAP), TEST_BOUNDS, 11);
    const header = await reader(copy).getHeader();
    expect(header.maxZoom).toBe(11);
    expect(await reader(copy).getZxy(12, 1210, 1464)).toBeUndefined();
  });

  it('writes and reads leaf directories when an area holds too many tiles for the root', async () => {
    const tiles = [];
    for (let z = 0; z <= 7; z++) {
      for (let x = 0; x < 2 ** z; x++) {
        for (let y = 0; y < 2 ** z; y++)
          tiles.push({ z, x, y, data: Uint8Array.from([z, x, y, 7]) });
      }
    }
    const archive = writePmtiles(tiles, {
      minZoom: 0,
      maxZoom: 7,
      bounds: [-180, -85, 180, 85],
      centerZoom: 0,
      metadata: {},
      tilesGzipped: true,
    });
    const header = await reader(archive).getHeader();
    expect(header.leafDirectoryLength).toBeGreaterThan(0);
    expect(header.rootDirectoryLength).toBeLessThanOrEqual(16_384 - 127);
    const path = join(work, 'world.pmtiles');
    writeFileSync(path, archive);
    const copy = await extract(fileSource(path), parseBounds('-73.7,45.2,-73.45,45.33'), 7);
    const copied = await reader(copy).getHeader();
    expect(copied.numAddressedTiles).toBe(8);
  });
});

describe('map label glyphs (scripts/make-glyphs.ts)', () => {
  function glyphs(file: string) {
    const found: { stack: string; range: string; glyphs: Map<number, Record<string, number>> } = {
      stack: '',
      range: '',
      glyphs: new Map(),
    };
    new PbfReader(readFileSync(join(GLYPHS_DIR, file))).readFields((tag, _, pbf) => {
      if (tag !== 1) return;
      pbf.readMessage((field, __, stack) => {
        if (field === 1) found.stack = stack.readString();
        else if (field === 2) found.range = stack.readString();
        else if (field === 3) {
          const glyph: Record<string, number> = { bitmap: 0 };
          stack.readMessage((key, ___, g) => {
            if (key === 2) glyph.bitmap = g.readBytes().length;
            else if (key === 5 || key === 6) glyph[key === 5 ? 'left' : 'top'] = g.readSVarint();
            else
              glyph[['', 'id', '', 'width', 'height', '', '', 'advance'][key] ?? 'x'] =
                g.readVarint();
          }, null);
          found.glyphs.set(glyph.id ?? -1, glyph);
        }
      }, null);
    }, null);
    return found;
  }

  it('cover French in Atkinson Hyperlegible Next, regular and bold', () => {
    for (const stack of ['Atkinson Hyperlegible Next Regular', 'Atkinson Hyperlegible Next Bold']) {
      const latin = glyphs(join(stack, '0-255.pbf'));
      expect(latin.stack).toBe(stack);
      expect(latin.range).toBe('0-255');
      for (const char of 'AÉéèêàâçôîïûùëÇ') {
        const glyph = latin.glyphs.get(char.charCodeAt(0));
        expect(glyph, char).toBeDefined();
        // A signed distance field: the glyph box plus a 3-pixel buffer on each side.
        expect(glyph?.bitmap).toBe(((glyph?.width ?? 0) + 6) * ((glyph?.height ?? 0) + 6));
      }
      // A space has no shape, only its width (Bold grows every advance by a pixel).
      expect(latin.glyphs.get(32)).toMatchObject({ bitmap: 0, width: 0 });
      expect(latin.glyphs.get(32)?.advance).toBe(stack.endsWith('Bold') ? 8 : 7);
      expect(glyphs(join(stack, '256-511.pbf')).glyphs.has(0x153)).toBe(true); // œ
      expect(glyphs(join(stack, '8192-8447.pbf')).glyphs.has(0x2019)).toBe(true); // ’
    }
  });

  it('draw bold wider than regular', () => {
    const regular = glyphs(join('Atkinson Hyperlegible Next Regular', '0-255.pbf')).glyphs.get(65);
    const bold = glyphs(join('Atkinson Hyperlegible Next Bold', '0-255.pbf')).glyphs.get(65);
    expect((bold?.advance ?? 0) - (regular?.advance ?? 0)).toBe(1);
  });
});

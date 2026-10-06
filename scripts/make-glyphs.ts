/**
 * Writes the map's label glyphs (public/map-assets/glyphs/) from the app's own font, Atkinson
 * Hyperlegible Next (one font for everything), so the offline map downloads nothing.
 *
 * MapLibre draws labels from signed distance fields in its glyph protobuf format, the one
 * node-fontnik writes: each glyph rendered at 24 px with a 3 px buffer, radius 8, cutoff 0.25.
 * Distances here are measured to the font's own outlines, not to a rasterized bitmap.
 *
 * Run: npm run glyphs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { PbfWriter } from 'pbf';

const ROOT = join(import.meta.dirname, '..');
export const GLYPHS_DIR = join(ROOT, 'public', 'map-assets', 'glyphs');
const FONT_FILES = [
  'atkinson-hyperlegible-next-latin-wght-normal.woff2',
  'atkinson-hyperlegible-next-latin-ext-wght-normal.woff2',
];

/** The range of U+FE00 to U+FEFF: variation selectors and the zero-width no-break space. */
const INVISIBLES = 0xfe00;

const SIZE = 24;
const BUFFER = 3;
const RADIUS = 8;
const CUTOFF = 0.25;
const CURVE_STEPS = 8;

/**
 * The font stacks the map style asks for. The font files hold the variable weight axis, which the
 * font library can't instance from WOFF2, so Bold grows each outline by 0.6 px (as FreeType's
 * emboldening does) and widens the advance to match.
 */
export const FONTSTACKS = [
  { name: 'Atkinson Hyperlegible Next Regular', embolden: 0 },
  { name: 'Atkinson Hyperlegible Next Bold', embolden: 0.6 },
] as const;

type Point = [number, number];
type Segment = [number, number, number, number];

interface Glyph {
  id: number;
  bitmap: Uint8Array | null;
  width: number;
  height: number;
  left: number;
  top: number;
  advance: number;
}

/** The outline as closed polygons, in font units, y up. Curves become short straight segments. */
function contoursOf(path: fontkit.Path): Point[][] {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let last: Point = [0, 0];
  const close = () => {
    if (current.length > 2) contours.push(current);
    current = [];
  };
  for (const { command, args } of path.commands) {
    const a = args;
    if (command === 'moveTo') {
      close();
      last = [a[0] ?? 0, a[1] ?? 0];
      current.push(last);
    } else if (command === 'lineTo') {
      last = [a[0] ?? 0, a[1] ?? 0];
      current.push(last);
    } else if (command === 'quadraticCurveTo') {
      const [cx = 0, cy = 0, x = 0, y = 0] = a;
      const [x0, y0] = last;
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        current.push([
          u * u * x0 + 2 * u * t * cx + t * t * x,
          u * u * y0 + 2 * u * t * cy + t * t * y,
        ]);
      }
      last = [x, y];
    } else if (command === 'bezierCurveTo') {
      const [c1x = 0, c1y = 0, c2x = 0, c2y = 0, x = 0, y = 0] = a;
      const [x0, y0] = last;
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        current.push([
          u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
          u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
        ]);
      }
      last = [x, y];
    } else {
      close();
    }
  }
  close();
  return contours;
}

function segmentsOf(contours: Point[][], scale: number): Segment[] {
  const segments: Segment[] = [];
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      if (a && b) segments.push([a[0] * scale, a[1] * scale, b[0] * scale, b[1] * scale]);
    }
  }
  return segments;
}

function distanceToSegment(x: number, y: number, [x0, y0, x1, y1]: Segment): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

/** Non-zero winding: TrueType and CFF outlines both fill by it. */
function inside(x: number, y: number, segments: readonly Segment[]): boolean {
  let winding = 0;
  for (const [x0, y0, x1, y1] of segments) {
    const side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
    if (y0 <= y && y1 > y && side > 0) winding++;
    else if (y1 <= y && y0 > y && side < 0) winding--;
  }
  return winding !== 0;
}

function glyphOf(font: fontkit.Font, codePoint: number, embolden: number, ascender: number): Glyph {
  const glyph = font.glyphForCodePoint(codePoint);
  const scale = SIZE / font.unitsPerEm;
  const advance = Math.round(glyph.advanceWidth * scale + 2 * embolden);
  const segments = segmentsOf(contoursOf(glyph.path), scale);
  if (segments.length === 0) {
    return { id: codePoint, bitmap: null, width: 0, height: 0, left: 0, top: -ascender, advance };
  }
  // Emboldening grows the outline on every side; shift right so the left bearing stays put.
  const shifted = segments.map(([a, b, c, d]): Segment => [a + embolden, b, c + embolden, d]);
  const xs = shifted.flatMap(([a, , c]) => [a, c]);
  const ys = shifted.flatMap(([, b, , d]) => [b, d]);
  const left = Math.floor(Math.min(...xs) - embolden);
  const right = Math.ceil(Math.max(...xs) + embolden);
  const bottom = Math.floor(Math.min(...ys) - embolden);
  const top = Math.ceil(Math.max(...ys) + embolden);
  const width = right - left;
  const height = top - bottom;
  const columns = width + 2 * BUFFER;
  const rows = height + 2 * BUFFER;
  const bitmap = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = left - BUFFER + column + 0.5;
      const y = top + BUFFER - row - 0.5;
      let distance = Infinity;
      for (const segment of shifted)
        distance = Math.min(distance, distanceToSegment(x, y, segment));
      const signed = (inside(x, y, shifted) ? -distance : distance) - embolden;
      const value = Math.round(255 - 255 * (signed / RADIUS + CUTOFF));
      bitmap[row * columns + column] = Math.max(0, Math.min(255, value));
    }
  }
  return { id: codePoint, bitmap, width, height, left, top: top - ascender, advance };
}

function writeGlyph(glyph: Glyph, pbf: PbfWriter): void {
  pbf.writeVarintField(1, glyph.id);
  if (glyph.bitmap) pbf.writeBytesField(2, glyph.bitmap);
  pbf.writeVarintField(3, glyph.width);
  pbf.writeVarintField(4, glyph.height);
  pbf.writeSVarintField(5, glyph.left);
  pbf.writeSVarintField(6, glyph.top);
  pbf.writeVarintField(7, glyph.advance);
}

/** One glyph range file: a `glyphs` message holding one font stack. */
export function rangePbf(name: string, start: number, glyphs: readonly Glyph[]): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(
    1,
    (list: readonly Glyph[], stack) => {
      stack.writeStringField(1, name);
      stack.writeStringField(2, `${String(start)}-${String(start + 255)}`);
      for (const glyph of list) stack.writeMessage(3, writeGlyph, glyph);
    },
    glyphs,
  );
  return pbf.finish();
}

function main(): void {
  const fonts = FONT_FILES.map((file) => fontkit.openSync(join(ROOT, 'public', 'fonts', file)));
  const [first] = fonts;
  if (!first || !('unitsPerEm' in first))
    throw new Error('Font files missing or not single fonts.');
  const fontFor = new Map<number, fontkit.Font>();
  for (const font of fonts as fontkit.Font[]) {
    for (const codePoint of font.characterSet) {
      if (codePoint < 0xffff && !fontFor.has(codePoint)) fontFor.set(codePoint, font);
    }
  }
  // Like FreeType's scaled ascender, rounded up: node-fontnik measures `top` from it.
  const ascender = Math.ceil((first.ascent * SIZE) / first.unitsPerEm);

  rmSync(GLYPHS_DIR, { recursive: true, force: true });
  let files = 0;
  for (const stack of FONTSTACKS) {
    const dir = join(GLYPHS_DIR, stack.name);
    mkdirSync(dir, { recursive: true });
    const byRange = new Map<number, Glyph[]>();
    for (const [codePoint, font] of [...fontFor].sort((a, b) => a[0] - b[0])) {
      const start = codePoint - (codePoint % 256);
      const list = byRange.get(start) ?? [];
      list.push(glyphOf(font, codePoint, stack.embolden, ascender));
      byRange.set(start, list);
    }
    // Some map names carry an invisible U+FEFF or U+FE0F, which the font doesn't have: the map still
    // asks for their range, and an empty range answers it instead of a missing file.
    if (!byRange.has(INVISIBLES)) byRange.set(INVISIBLES, []);
    for (const [start, glyphs] of byRange) {
      writeFileSync(
        join(dir, `${String(start)}-${String(start + 255)}.pbf`),
        rangePbf(stack.name, start, glyphs),
      );
      files++;
    }
  }
  console.log(
    `Wrote ${String(files)} glyph ranges for ${String(fontFor.size)} characters → ${GLYPHS_DIR}`,
  );
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();

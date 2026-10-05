/**
 * Writes PMTiles v3 archives (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md):
 * the offline basemap format. Used by make-basemap.ts and make-test-basemap.ts;
 * the official `pmtiles` library reads them back in the tests.
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { zxyToTileId } from 'pmtiles';

export interface TileInput {
  z: number;
  x: number;
  y: number;
  /** The tile's bytes: an MVT tile, gzipped when the archive info says so. */
  data: Uint8Array;
}

export interface ArchiveInfo {
  minZoom: number;
  maxZoom: number;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  centerZoom: number;
  metadata: Record<string, unknown>;
  /** The tiles are gzipped already (copied from another archive): stored as they are. */
  tilesGzipped?: boolean;
}

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

const HEADER_LENGTH = 127;
// The header and root directory must fit in the first 16 KiB, so a reader gets both in one request.
const ROOT_LIMIT = 16_384 - HEADER_LENGTH;
const NONE = 1;
const GZIP = 2;
const MVT = 1;

function varints(values: readonly number[]): number[] {
  const bytes: number[] = [];
  for (const value of values) {
    let rest = value;
    while (rest >= 0x80) {
      bytes.push((rest % 0x80) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    bytes.push(rest);
  }
  return bytes;
}

/** A directory: entry count, then tile IDs as deltas, run lengths, lengths, offsets (0 = right after the previous). */
export function serializeDirectory(entries: readonly Entry[]): Uint8Array {
  const values: number[] = [entries.length];
  let lastId = 0;
  for (const entry of entries) {
    values.push(entry.tileId - lastId);
    lastId = entry.tileId;
  }
  for (const entry of entries) values.push(entry.runLength);
  for (const entry of entries) values.push(entry.length);
  entries.forEach((entry, i) => {
    const previous = entries[i - 1];
    const follows = previous !== undefined && entry.offset === previous.offset + previous.length;
    values.push(follows ? 0 : entry.offset + 1);
  });
  return Uint8Array.from(varints(values));
}

/** The root directory, with leaf directories when the entries don't fit in it. */
function directories(entries: readonly Entry[]): { root: Uint8Array; leaves: Uint8Array } {
  const root = serializeDirectory(entries);
  if (root.length <= ROOT_LIMIT) return { root, leaves: new Uint8Array(0) };
  for (let perLeaf = 4096; ; perLeaf *= 2) {
    const rootEntries: Entry[] = [];
    const chunks: Uint8Array[] = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += perLeaf) {
      const slice = entries.slice(i, i + perLeaf);
      const leaf = serializeDirectory(slice);
      const first = slice[0];
      if (!first) continue;
      rootEntries.push({ tileId: first.tileId, offset, length: leaf.length, runLength: 0 });
      chunks.push(leaf);
      offset += leaf.length;
    }
    const leafRoot = serializeDirectory(rootEntries);
    if (leafRoot.length <= ROOT_LIMIT) return { root: leafRoot, leaves: concat(chunks) };
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * An archive of gzipped tiles in tile ID order (clustered), identical tiles stored once:
 * the sea and empty farmland repeat a lot.
 */
export function writePmtiles(tiles: readonly TileInput[], info: ArchiveInfo): Uint8Array {
  const sorted = tiles
    .map((tile) => ({ tileId: zxyToTileId(tile.z, tile.x, tile.y), data: tile.data }))
    .sort((a, b) => a.tileId - b.tileId);

  const entries: Entry[] = [];
  const chunks: Uint8Array[] = [];
  const stored = new Map<string, { offset: number; length: number }>();
  let offset = 0;
  for (const { tileId, data } of sorted) {
    const key = createHash('sha1').update(data).digest('hex');
    let place = stored.get(key);
    if (!place) {
      const gzipped = info.tilesGzipped ? data : gzipSync(data);
      place = { offset, length: gzipped.length };
      stored.set(key, place);
      chunks.push(gzipped);
      offset += gzipped.length;
    }
    const last = entries.at(-1);
    if (
      last &&
      last.offset === place.offset &&
      last.length === place.length &&
      last.tileId + last.runLength === tileId
    ) {
      last.runLength++;
    } else {
      entries.push({ tileId, offset: place.offset, length: place.length, runLength: 1 });
    }
  }

  const { root, leaves } = directories(entries);
  const metadata = new TextEncoder().encode(JSON.stringify(info.metadata));
  const tileData = concat(chunks);
  const rootOffset = HEADER_LENGTH;
  const metadataOffset = rootOffset + root.length;
  const leavesOffset = metadataOffset + metadata.length;
  const tilesOffset = leavesOffset + leaves.length;

  const header = new DataView(new ArrayBuffer(HEADER_LENGTH));
  new TextEncoder().encodeInto('PMTiles', new Uint8Array(header.buffer, 0, 7));
  header.setUint8(7, 3);
  const u64 = (at: number, value: number) => {
    header.setBigUint64(at, BigInt(value), true);
  };
  u64(8, rootOffset);
  u64(16, root.length);
  u64(24, metadataOffset);
  u64(32, metadata.length);
  u64(40, leavesOffset);
  u64(48, leaves.length);
  u64(56, tilesOffset);
  u64(64, tileData.length);
  u64(72, sorted.length);
  u64(80, entries.length);
  u64(88, stored.size);
  header.setUint8(96, 1);
  header.setUint8(97, NONE);
  header.setUint8(98, GZIP);
  header.setUint8(99, MVT);
  header.setUint8(100, info.minZoom);
  header.setUint8(101, info.maxZoom);
  const e7 = (degrees: number) => Math.round(degrees * 1e7);
  const [west, south, east, north] = info.bounds;
  header.setInt32(102, e7(west), true);
  header.setInt32(106, e7(south), true);
  header.setInt32(110, e7(east), true);
  header.setInt32(114, e7(north), true);
  header.setUint8(118, info.centerZoom);
  header.setInt32(119, e7((west + east) / 2), true);
  header.setInt32(123, e7((south + north) / 2), true);

  return concat([new Uint8Array(header.buffer), root, metadata, leaves, tileData]);
}

/** The tiles covering a bounding box at one zoom (Web Mercator, as every web map). */
export function tilesInBounds(
  [west, south, east, north]: readonly [number, number, number, number],
  z: number,
): { x: number; y: number }[] {
  const n = 2 ** z;
  const tileX = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const tileY = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    return Math.min(n - 1, Math.max(0, Math.floor(y)));
  };
  const tiles: { x: number; y: number }[] = [];
  for (let x = tileX(west); x <= tileX(east); x++) {
    for (let y = tileY(north); y <= tileY(south); y++) tiles.push({ x, y });
  }
  return tiles;
}

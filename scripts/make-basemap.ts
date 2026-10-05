/**
 * Makes the offline map of a campaign area: copies the area's tiles out of a recent
 * Protomaps daily build into one .pmtiles file to load in Terrain (Settings → Offline map).
 *
 *   npm run basemap -- <west,south,east,north> [--maxzoom 15] [--out file.pmtiles] [--source url-or-file]
 *
 * The area is what Terrain copies with "Copy campaign area". Without --source, the newest daily build
 * on build.protomaps.com is used. Plain Node, no pmtiles.exe: the script reads the archive's
 * directories, then fetches the needed tiles in large batched range requests, as `pmtiles extract`
 * does. Map data © OpenStreetMap contributors.
 */
import { open } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  bytesToHeader,
  Compression,
  findTile,
  readVarint,
  zxyToTileId,
  type Entry,
  type Header,
} from 'pmtiles';
import { tilesInBounds, writePmtiles, type TileInput } from './pmtiles.ts';

export type Bounds = [number, number, number, number];

/** Reads byte ranges of an archive: a local file or a URL. */
export interface ByteSource {
  name: string;
  read(offset: number, length: number): Promise<Uint8Array>;
}

// Tiles closer than this in the archive are fetched in one request; batches stay under 32 MB.
const MAX_GAP = 256 * 1024;
const MAX_BATCH = 32 * 1024 * 1024;
const PARALLEL = 4;

export function parseBounds(text: string): Bounds {
  const parts = text.split(',').map((part) => Number(part.trim()));
  const [west, south, east, north] = parts;
  if (
    parts.length !== 4 ||
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined ||
    parts.some((n) => !Number.isFinite(n)) ||
    west >= east ||
    south >= north ||
    south < -85 ||
    north > 85
  ) {
    throw new Error(
      `"${text}" is not an area. Paste what Terrain copies with "Copy campaign area": west,south,east,north.`,
    );
  }
  return [west, south, east, north];
}

export function fileSource(path: string): ByteSource {
  return {
    name: path,
    async read(offset, length) {
      const handle = await open(path, 'r');
      try {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
  };
}

export function urlSource(url: string): ByteSource {
  return {
    name: url,
    async read(offset, length) {
      for (let attempt = 1; ; attempt++) {
        try {
          const response = await fetch(url, {
            headers: { Range: `bytes=${String(offset)}-${String(offset + length - 1)}` },
          });
          if (response.status !== 206 && response.status !== 200)
            throw new Error(`HTTP ${String(response.status)}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          return response.status === 200 ? bytes.subarray(offset, offset + length) : bytes;
        } catch (error) {
          if (attempt >= 4) throw error;
          await new Promise((done) => setTimeout(done, 1000 * attempt));
        }
      }
    },
  };
}

/** The newest Protomaps daily build of the last two weeks. */
export async function newestBuild(today = new Date()): Promise<string> {
  for (let daysAgo = 0; daysAgo < 14; daysAgo++) {
    const day = new Date(today.getTime() - daysAgo * 86_400_000);
    const stamp = day.toISOString().slice(0, 10).replaceAll('-', '');
    const url = `https://build.protomaps.com/${stamp}.pmtiles`;
    const response = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (response?.ok) return url;
  }
  throw new Error(
    'No Protomaps daily build found for the last two weeks. Check the internet connection.',
  );
}

function deserializeDirectory(bytes: Uint8Array): Entry[] {
  const p = { buf: bytes, pos: 0 };
  const count = readVarint(p);
  const entries: Entry[] = [];
  let lastId = 0;
  for (let i = 0; i < count; i++) {
    lastId += readVarint(p);
    entries.push({ tileId: lastId, offset: 0, length: 0, runLength: 1 });
  }
  for (const entry of entries) entry.runLength = readVarint(p);
  for (const entry of entries) entry.length = readVarint(p);
  entries.forEach((entry, i) => {
    const value = readVarint(p);
    const previous = entries[i - 1];
    entry.offset = value === 0 && previous ? previous.offset + previous.length : value - 1;
  });
  return entries;
}

function inflate(bytes: Uint8Array, compression: Compression): Uint8Array {
  if (compression === Compression.None) return bytes;
  if (compression === Compression.Gzip) return new Uint8Array(gunzipSync(bytes));
  throw new Error(`This archive uses a compression Terrain can't read (${String(compression)}).`);
}

interface Wanted {
  z: number;
  x: number;
  y: number;
  tileId: number;
}

/** Copies the tiles of an area out of an archive. */
export async function extract(
  source: ByteSource,
  bounds: Bounds,
  maxZoom: number,
  progress: (done: number, total: number) => void = () => undefined,
): Promise<Uint8Array> {
  const start = await source.read(0, 16_384);
  const header: Header = bytesToHeader(
    start.buffer.slice(start.byteOffset, start.byteOffset + start.byteLength) as ArrayBuffer,
  );
  if (header.specVersion !== 3) throw new Error('Only PMTiles version 3 archives can be read.');
  if (header.tileCompression !== Compression.Gzip && header.tileCompression !== Compression.None)
    throw new Error('Only gzipped or uncompressed tiles can be copied.');
  const top = Math.min(maxZoom, header.maxZoom);

  const readDirectory = async (offset: number, length: number) =>
    deserializeDirectory(inflate(await source.read(offset, length), header.internalCompression));
  const root = await readDirectory(header.rootDirectoryOffset, header.rootDirectoryLength);
  const leaves = new Map<number, Promise<Entry[]>>();
  const leaf = (entry: Entry) => {
    let directory = leaves.get(entry.offset);
    if (!directory) {
      directory = readDirectory(header.leafDirectoryOffset + entry.offset, entry.length);
      leaves.set(entry.offset, directory);
    }
    return directory;
  };

  const wanted: Wanted[] = [];
  for (let z = header.minZoom; z <= top; z++) {
    for (const { x, y } of tilesInBounds(bounds, z))
      wanted.push({ z, x, y, tileId: zxyToTileId(z, x, y) });
  }

  // Where each tile's bytes are: through the root, then a leaf directory when there is one.
  const located: { tile: Wanted; offset: number; length: number }[] = [];
  for (const tile of wanted) {
    let directory = root;
    for (let depth = 0; depth < 4; depth++) {
      const entry = findTile(directory, tile.tileId);
      if (!entry) break;
      if (entry.runLength > 0) {
        located.push({ tile, offset: entry.offset, length: entry.length });
        break;
      }
      directory = await leaf(entry);
    }
  }

  // Batches of nearby tile bytes: one request each.
  const ranges = [...new Map(located.map((l) => [l.offset, l.length])).entries()].sort(
    (a, b) => a[0] - b[0],
  );
  const batches: { offset: number; end: number }[] = [];
  for (const [offset, length] of ranges) {
    const batch = batches.at(-1);
    if (batch && offset - batch.end <= MAX_GAP && offset + length - batch.offset <= MAX_BATCH) {
      batch.end = Math.max(batch.end, offset + length);
    } else {
      batches.push({ offset, end: offset + length });
    }
  }
  const bytesAt = new Map<number, Uint8Array>();
  let done = 0;
  const queue = [...batches];
  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      const data = await source.read(
        header.tileDataOffset + batch.offset,
        batch.end - batch.offset,
      );
      for (const [offset, length] of ranges) {
        if (offset >= batch.offset && offset + length <= batch.end)
          bytesAt.set(offset, data.subarray(offset - batch.offset, offset - batch.offset + length));
      }
      done++;
      progress(done, batches.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const tiles: TileInput[] = [];
  for (const { tile, offset } of located) {
    const data = bytesAt.get(offset);
    if (data) tiles.push({ z: tile.z, x: tile.x, y: tile.y, data });
  }

  let metadata: Record<string, unknown> = {};
  if (header.jsonMetadataLength > 0) {
    const raw = inflate(
      await source.read(header.jsonMetadataOffset, header.jsonMetadataLength),
      header.internalCompression,
    );
    metadata = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  }
  return writePmtiles(tiles, {
    minZoom: header.minZoom,
    maxZoom: top,
    bounds,
    centerZoom: Math.min(top, 12),
    tilesGzipped: header.tileCompression === Compression.Gzip,
    metadata: { ...metadata, terrain: { extractedFrom: source.name, bounds } },
  });
}

/** "--name value" options, and the rest in order. */
function parseArgs(args: readonly string[]): {
  positional: string[];
  options: Map<string, string>;
} {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg.startsWith('--')) options.set(arg, args[++i] ?? '');
    else positional.push(arg);
  }
  return { positional, options };
}

async function main(): Promise<void> {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const option = (name: string) => options.get(name);
  const [area] = positional;
  if (!area) {
    console.log(
      'Usage: npm run basemap -- <west,south,east,north> [--maxzoom 15] [--out file.pmtiles] [--source url-or-file]',
    );
    console.log(
      'The area is what Terrain copies with "Copy campaign area" (Settings → Offline map).',
    );
    process.exitCode = 1;
    return;
  }
  const bounds = parseBounds(area);
  const maxZoom = Number(option('--maxzoom') ?? 15);
  const sourceArg = option('--source');
  const source = sourceArg
    ? /^https?:/.test(sourceArg)
      ? urlSource(sourceArg)
      : fileSource(resolve(sourceArg))
    : urlSource(await newestBuild());
  const date = new Date().toISOString().slice(0, 10);
  const out = resolve(option('--out') ?? join('basemaps', `terrain-basemap-${date}.pmtiles`));
  console.log(`Copying ${area} up to zoom ${String(maxZoom)} from ${source.name}`);
  const archive = await extract(source, bounds, maxZoom, (done, total) => {
    process.stdout.write(`\r  ${String(done)} of ${String(total)} batches`);
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, archive);
  console.log(`\nWrote ${(archive.length / 1_048_576).toFixed(1)} MB → ${out}`);
  console.log(
    'Copy this file to the phone, then in Terrain: Settings → Offline map → Load a map file.',
  );
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

import { FileSource, PMTiles, TileType } from 'pmtiles';
import type { BasemapInfo, TerrainDb } from './db.ts';

/** The offline map file in the origin's private file system (OPFS, §8). */
const FILE_NAME = 'basemap.pmtiles';

export type BasemapErrorCode = 'not-a-map' | 'not-vector' | 'no-room' | 'unsupported';

export class BasemapError extends Error {
  readonly code: BasemapErrorCode;

  constructor(code: BasemapErrorCode) {
    super(code);
    this.name = 'BasemapError';
    this.code = code;
  }
}

/** The file's PMTiles header, or why it can't be Terrain's offline map. */
async function headerOf(file: File) {
  try {
    const header = await new PMTiles(new FileSource(file)).getHeader();
    if (header.tileType !== TileType.Mvt) throw new BasemapError('not-vector');
    return header;
  } catch (error) {
    throw error instanceof BasemapError ? error : new BasemapError('not-a-map');
  }
}

async function directory(): Promise<FileSystemDirectoryHandle> {
  if (!('storage' in navigator) || !('getDirectory' in navigator.storage))
    throw new BasemapError('unsupported');
  return navigator.storage.getDirectory();
}

/** Loads a map file made by `npm run basemap` (Settings → Offline map), replacing the one before. */
export async function saveBasemap(db: TerrainDb, file: File, now: string): Promise<BasemapInfo> {
  const header = await headerOf(file);
  const root = await directory();
  try {
    const handle = await root.getFileHandle(FILE_NAME, { create: true });
    const writable = await handle.createWritable();
    await file.stream().pipeTo(writable);
  } catch (error) {
    await root.removeEntry(FILE_NAME).catch(() => undefined);
    await db.basemaps.delete('current');
    throw error instanceof DOMException && error.name === 'QuotaExceededError'
      ? new BasemapError('no-room')
      : error;
  }
  const info: BasemapInfo = {
    id: 'current',
    name: file.name,
    size: file.size,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    loadedAt: now,
  };
  await db.basemaps.put(info);
  return info;
}

/** The loaded map and its file, or null when there is none (or OPFS lost it). */
export async function openBasemap(
  db: TerrainDb,
): Promise<{ info: BasemapInfo; file: File } | null> {
  const info = await db.basemaps.get('current');
  if (!info) return null;
  try {
    const handle = await (await directory()).getFileHandle(FILE_NAME);
    return { info, file: await handle.getFile() };
  } catch {
    return null;
  }
}

export async function removeBasemap(db: TerrainDb): Promise<void> {
  await db.basemaps.delete('current');
  const root = await directory().catch(() => null);
  await root?.removeEntry(FILE_NAME).catch(() => undefined);
}

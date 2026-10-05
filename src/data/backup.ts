import { fileDate } from '../domain/format.ts';
import type { Campaign, Row } from '../domain/types.ts';
import {
  SCHEMA_VERSION,
  withOwnerFields,
  type PendingCall,
  type Settings,
  type StoredEvent,
  type TerrainDb,
} from './db.ts';

/** The whole database in one file (§5.8). Restore replaces everything on the device with it. */
export interface Backup {
  format: 'terrain-backup';
  version: number;
  /** The storage version the data was read from. */
  schema: number;
  createdAt: string;
  campaigns: Campaign[];
  rows: Row[];
  events: StoredEvent[];
  settings: Settings[];
  pendingCalls: PendingCall[];
}

const FORMAT = 'terrain-backup';
const VERSION = 1;

export type RestoreErrorCode = 'not-a-backup' | 'newer-backup' | 'damaged-backup';

export class RestoreError extends Error {
  readonly code: RestoreErrorCode;

  constructor(code: RestoreErrorCode) {
    super(code);
    this.name = 'RestoreError';
    this.code = code;
  }
}

const tables = (db: TerrainDb) => [db.campaigns, db.rows, db.events, db.settings, db.pendingCalls];

export async function makeBackup(db: TerrainDb, now: string): Promise<Backup> {
  return db.transaction('r', tables(db), async () => ({
    format: FORMAT,
    version: VERSION,
    schema: SCHEMA_VERSION,
    createdAt: now,
    campaigns: await db.campaigns.toArray(),
    rows: await db.rows.toArray(),
    events: await db.events.toArray(),
    settings: await db.settings.toArray(),
    pendingCalls: await db.pendingCalls.toArray(),
  }));
}

/** "Terrain_backup_2026-10-01.json" (§5.8). */
export function backupFileName(now: string): string {
  return `Terrain_backup_${fileDate(now)}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOf(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const list = data[key];
  if (!Array.isArray(list) || !list.every(isRecord)) throw new RestoreError('damaged-backup');
  return list;
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** Reads a backup file, refusing anything that isn't a whole Terrain backup this version can restore. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RestoreError('not-a-backup');
  }
  if (!isRecord(data) || data.format !== FORMAT) throw new RestoreError('not-a-backup');
  if (
    typeof data.version !== 'number' ||
    typeof data.schema !== 'number' ||
    !isText(data.createdAt)
  )
    throw new RestoreError('damaged-backup');
  if (data.version > VERSION || data.schema > SCHEMA_VERSION)
    throw new RestoreError('newer-backup');
  // Backups exist from storage version 2 on (Phase 2).
  if (data.schema < 2) throw new RestoreError('damaged-backup');
  const valid =
    listOf(data, 'campaigns').every((campaign) => isText(campaign.id)) &&
    listOf(data, 'rows').every((row) => isText(row.rowId) && isText(row.campaignId)) &&
    listOf(data, 'events').every(
      (event) =>
        isText(event.id) &&
        isText(event.campaignId) &&
        isText(event.type) &&
        typeof event.seq === 'number',
    ) &&
    listOf(data, 'settings').every((settings) => settings.key === 'app') &&
    listOf(data, 'pendingCalls').every((call) => isText(call.id) && isText(call.campaignId));
  if (!valid) throw new RestoreError('damaged-backup');
  const backup = data as unknown as Backup;
  // The upgrades of an older version's backup, as the database got them (db.ts).
  return backup.schema < 3
    ? { ...backup, schema: SCHEMA_VERSION, campaigns: backup.campaigns.map(withOwnerFields) }
    : backup;
}

/** Replaces everything on the device with the backup, in one transaction: all of it, or nothing. */
export async function restoreBackup(db: TerrainDb, backup: Backup): Promise<void> {
  await db.transaction('rw', tables(db), async () => {
    for (const table of tables(db)) await table.clear();
    await db.campaigns.bulkAdd(backup.campaigns);
    await db.rows.bulkAdd(backup.rows);
    await db.events.bulkAdd(backup.events);
    await db.settings.bulkAdd(backup.settings);
    await db.pendingCalls.bulkAdd(backup.pendingCalls);
  });
}

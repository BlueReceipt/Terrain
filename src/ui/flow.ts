import { computed, signal } from '@preact/signals';
import { ulid } from 'ulid';
import {
  backupFileName,
  makeBackup,
  parseBackup,
  restoreBackup,
  RestoreError,
  type Backup,
  type RestoreErrorCode,
} from '../data/backup.ts';
import {
  BasemapError,
  openBasemap,
  removeBasemap,
  saveBasemap,
  type BasemapErrorCode,
} from '../data/basemap.ts';
import { nowWithOffset } from '../data/clock.ts';
import { TerrainDb, type BasemapInfo, type Settings, type StoredEvent } from '../data/db.ts';
import { readImportFile, saveFile } from '../data/files.ts';
import { SAMPLE_NAME, sampleFile } from './sample.ts';
import {
  campaignEvents,
  commitImport,
  loadLastCampaign,
  loadSettings,
  markExported,
  recordStoragePersistence,
  type LoadedCampaign,
} from '../data/repo.ts';
import { ImportError, type ImportErrorCode } from '../domain/errors.ts';
import {
  initialColorMap,
  missingRoles,
  planImport,
  withLotColumn,
  withOldParcelIds,
  withParcelIdColumn,
  type ImportPlan,
} from '../domain/importPlan.ts';
import { ownNoteTexts } from '../domain/notes.ts';
import type { ColumnRoles, FieldRole, ParsedFile, Status } from '../domain/types.ts';
import { registerBasemap } from '../map/maplibre.ts';
import { strings } from './strings.ts';

export type Screen =
  | { name: 'starting' }
  | { name: 'home' }
  | { name: 'reading'; fileName: string }
  | { name: 'failed'; reason: ImportErrorCode | 'unexpected' | 'storage' }
  | { name: 'mapping'; parsed: ParsedFile; roles: ColumnRoles; missing: FieldRole[] }
  | {
      name: 'colors';
      parsed: ParsedFile;
      roles: ColumnRoles;
      colorMap: Record<string, string>;
      unmatched: string[];
    }
  | { name: 'report'; plan: ImportPlan; saving: boolean; saveFailed: boolean }
  | { name: 'campaign' }
  | { name: 'restore'; backup: Backup; restoring: boolean }
  | { name: 'restoreFailed'; reason: RestoreErrorCode | 'storage' }
  | { name: 'settings' };

export const screen = signal<Screen>({ name: 'starting' });
export const current = signal<LoadedCampaign | null>(null);
export const settings = signal<Settings | null>(null);
export const statuses = computed<readonly Status[]>(() => settings.value?.statuses ?? []);
/** The file name of the last backup saved in this session. */
export const lastBackup = signal<string | null>(null);
/** The offline map, and the URL the map reads it through. */
export const basemap = signal<{ info: BasemapInfo; url: string } | null>(null);
export const basemapState = signal<{ loading: boolean; error: BasemapErrorCode | null }>({
  loading: false,
  error: null,
});

/** The open campaign's event log, in order: notes, lot notes, Undo and the day log read it. */
export const events = signal<StoredEvent[]>([]);

let db: TerrainDb | null = null;

/** The database, for the actions of the house card (src/ui/actions.ts). */
export function database(): TerrainDb | null {
  return db;
}

async function loadEvents(store: TerrainDb): Promise<void> {
  events.value = current.value ? await campaignEvents(store, current.value.campaign.id) : [];
}

async function openLast(store: TerrainDb): Promise<void> {
  settings.value = await loadSettings(store);
  current.value = await loadLastCampaign(store);
  await loadEvents(store);
  screen.value = current.value ? { name: 'campaign' } : { name: 'home' };
  const map = await openBasemap(store).catch(() => null);
  basemap.value = map
    ? { info: map.info, url: registerBasemap(map.file, map.info.loadedAt) }
    : null;
}

export function openSettings(): void {
  screen.value = { name: 'settings' };
}

/** Settings → Offline map → Load a map file. */
export async function loadBasemap(file: File): Promise<void> {
  if (!db) return;
  basemapState.value = { loading: true, error: null };
  try {
    const info = await saveBasemap(db, file, nowWithOffset());
    const map = await openBasemap(db);
    basemap.value = map ? { info, url: registerBasemap(map.file, info.loadedAt) } : null;
    basemapState.value = { loading: false, error: null };
  } catch (error) {
    basemapState.value = {
      loading: false,
      error: error instanceof BasemapError ? error.code : 'not-a-map',
    };
  }
}

export async function unloadBasemap(): Promise<void> {
  if (!db) return;
  await removeBasemap(db);
  basemap.value = null;
  basemapState.value = { loading: false, error: null };
}

export async function start(): Promise<void> {
  try {
    db = new TerrainDb();
    await openLast(db);
  } catch {
    screen.value = { name: 'failed', reason: 'storage' };
  }
}

export function leaveImport(): void {
  screen.value = current.value ? { name: 'campaign' } : { name: 'home' };
}

/** Roles found in the file first; the campaign's earlier choices fill gaps when those columns exist. */
function rolesFor(parsed: ParsedFile): ColumnRoles {
  const roles: ColumnRoles = { ...parsed.roles };
  const earlier = current.value?.campaign.roles ?? {};
  for (const [role, column] of Object.entries(earlier) as [FieldRole, string][]) {
    if (roles[role] === undefined && parsed.columns.includes(column)) roles[role] = column;
  }
  return roles;
}

/** The poutine sample on the public demo's first screen, read like a file the user picked. */
export async function pickSample(): Promise<void> {
  screen.value = { name: 'reading', fileName: SAMPLE_NAME };
  let file: File;
  try {
    file = await sampleFile();
  } catch {
    screen.value = { name: 'failed', reason: 'unexpected' };
    return;
  }
  await pickFile(file);
}

export async function pickFile(file: File): Promise<void> {
  screen.value = { name: 'reading', fileName: file.name };
  try {
    const parsed = await readImportFile(file);
    const roles = rolesFor(parsed);
    const missing = missingRoles(parsed, roles);
    if (missing.length > 0) screen.value = { name: 'mapping', parsed, roles, missing };
    else showColors(parsed, roles);
  } catch (error) {
    screen.value = {
      name: 'failed',
      reason: error instanceof ImportError ? error.code : 'unexpected',
    };
  }
}

export function confirmMapping(
  parsed: ParsedFile,
  roles: ColumnRoles,
  chosen: Partial<Record<FieldRole, string>>,
): void {
  const merged: ColumnRoles = { ...roles, ...chosen };
  const withId =
    merged.parcelId !== undefined ? withParcelIdColumn(parsed, merged.parcelId) : parsed;
  showColors(withId, merged);
}

function showColors(parsed: ParsedFile, roles: ColumnRoles): void {
  const { colorMap, unmatched } = initialColorMap(
    parsed,
    statuses.value,
    current.value?.campaign.colorMap,
  );
  if (Object.keys(colorMap).length === 0) showReport(parsed, roles, colorMap, false);
  else screen.value = { name: 'colors', parsed, roles, colorMap, unmatched };
}

export function showReport(
  parsed: ParsedFile,
  roles: ColumnRoles,
  colorMap: Record<string, string>,
  asNewCampaign: boolean,
): void {
  const target = asNewCampaign ? null : current.value;
  const plan = planImport({
    parsed,
    campaign: target?.campaign ?? null,
    existingRows: target?.rows ?? [],
    statuses: statuses.value,
    roles,
    colorMap,
    lotColumn: target?.campaign.lotColumn ?? null,
    now: nowWithOffset(),
    newId: ulid,
    // An export coming back carries Terrain's notes in its Notes cells: recognized, not doubled.
    ownNotes: target ? ownNoteTexts(events.value, strings.notes) : undefined,
  });
  screen.value = { name: 'report', plan, saving: false, saveFailed: false };
}

function updatePlan(change: (plan: ImportPlan) => ImportPlan): void {
  const now = screen.value;
  if (now.name === 'report') screen.value = { ...now, plan: change(now.plan), saveFailed: false };
}

export function setLotColumn(column: string | null): void {
  updatePlan((plan) => withLotColumn(plan, column));
}

export function toggleOldParcelId(rowId: string, id: string): void {
  updatePlan((plan) => {
    const row = plan.merge.rows.find((r) => r.rowId === rowId);
    const old = row?.oldParcelIds ?? [];
    return withOldParcelIds(
      plan,
      rowId,
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  });
}

export function startNewCampaign(): void {
  const now = screen.value;
  if (now.name === 'report')
    showReport(now.plan.parsed, now.plan.campaign.roles, now.plan.campaign.colorMap, true);
}

export async function openCampaign(): Promise<void> {
  const now = screen.value;
  if (now.name !== 'report' || !db) return;
  screen.value = { ...now, saving: true };
  try {
    current.value = await commitImport(db, now.plan, ulid(), nowWithOffset());
    await loadEvents(db);
    screen.value = { name: 'campaign' };
  } catch {
    screen.value = { ...now, saving: false, saveFailed: true };
    return;
  }
  // Ask for durable storage after the first successful import.
  const saved = await loadSettings(db);
  if (saved.storagePersisted === null && 'storage' in navigator && 'persist' in navigator.storage) {
    await recordStoragePersistence(db, await navigator.storage.persist());
  }
}

/** Back up: the whole database as one JSON file in the downloads. */
export async function backUp(): Promise<void> {
  if (!db) return;
  const now = nowWithOffset();
  const fileName = backupFileName(now);
  saveFile(fileName, JSON.stringify(await makeBackup(db, now)), 'application/json');
  lastBackup.value = fileName;
  // Exporting resets the "not exported" counter: the backup holds every campaign.
  for (const campaign of await db.campaigns.toArray()) await markExported(db, campaign.id, now);
}

export async function pickBackup(file: File): Promise<void> {
  try {
    screen.value = { name: 'restore', backup: parseBackup(await file.text()), restoring: false };
  } catch (error) {
    screen.value = {
      name: 'restoreFailed',
      reason: error instanceof RestoreError ? error.code : 'not-a-backup',
    };
  }
}

/** Restore, after Alex confirms: everything on the phone is replaced by the backup. */
export async function confirmRestore(): Promise<void> {
  const now = screen.value;
  if (now.name !== 'restore' || !db) return;
  screen.value = { ...now, restoring: true };
  try {
    await restoreBackup(db, now.backup);
    lastBackup.value = null;
    await openLast(db);
  } catch {
    screen.value = { name: 'restoreFailed', reason: 'storage' };
  }
}

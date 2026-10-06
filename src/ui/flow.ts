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
import { lookUpAddresses } from '../data/lookups.ts';
import {
  campaignEvents,
  commitImport,
  loadLastCampaign,
  loadSettings,
  markExported,
  recordStoragePersistence,
  type LoadedCampaign,
} from '../data/repo.ts';
import {
  addressKey,
  housesToFind,
  placementFor,
  type AddressCandidate,
  type Placement,
} from '../domain/addresses.ts';
import { ImportError, type ImportErrorCode } from '../domain/errors.ts';
import {
  initialColorMap,
  missingRoles,
  planImport,
  withLotColumn,
  withOldParcelIds,
  withParcelIdColumn,
  withPlacements,
  type ImportPlan,
} from '../domain/importPlan.ts';
import { myMapsId } from '../domain/mymaps.ts';
import { ownNoteTexts } from '../domain/notes.ts';
import type { ColumnRoles, FieldRole, ParsedFile, Status } from '../domain/types.ts';
import { registerBasemap } from '../map/maplibre.ts';
import {
  isPublicDemo,
  MyMapsError,
  myMapsFile,
  SAMPLE_NAME,
  sampleFile,
  type MyMapsProblem,
} from './demo.ts';
import { hasRelay } from './online.ts';
import { strings } from './strings.ts';

/** Why an import stopped: the file, the device's storage, or a My Maps link on the demo. */
export type FailedReason = ImportErrorCode | 'unexpected' | 'storage' | `mymaps-${MyMapsProblem}`;

/** What became of an import's address lookups, for its report; null when none was asked. */
export type LookUp = 'done' | 'failed' | 'stopped' | null;

export type Screen =
  | { name: 'starting' }
  | { name: 'home' }
  | { name: 'reading'; fileName: string }
  | { name: 'failed'; reason: FailedReason }
  | { name: 'mapping'; parsed: ParsedFile; roles: ColumnRoles; missing: FieldRole[] }
  | {
      name: 'colors';
      parsed: ParsedFile;
      roles: ColumnRoles;
      colorMap: Record<string, string>;
      unmatched: string[];
    }
  | { name: 'placing'; total: number; done: number }
  | { name: 'report'; plan: ImportPlan; saving: boolean; saveFailed: boolean; lookUp: LookUp }
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

/** After a My Maps link fails: back where links are opened, the first screen or Settings. */
export function backToLinks(): void {
  screen.value = current.value ? { name: 'settings' } : { name: 'home' };
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

/** A My Maps map by its link, on the public demo: fetched through the relay, then read like a file. */
export async function pickMyMapsLink(id: string): Promise<void> {
  screen.value = { name: 'reading', fileName: strings.home.linkReading };
  let file: File;
  try {
    file = await myMapsFile(id);
  } catch (error) {
    screen.value = {
      name: 'failed',
      reason: error instanceof MyMapsError ? `mymaps-${error.problem}` : 'mymaps-unexpected',
    };
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
    // On the demo, a file that only links to its map online opens that map through the relay.
    const linked =
      error instanceof ImportError &&
      error.code === 'network-link-only' &&
      isPublicDemo(location.hostname)
        ? myMapsId(error.link ?? '')
        : null;
    if (linked) {
      await pickMyMapsLink(linked);
      return;
    }
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
  if (Object.keys(colorMap).length === 0) void showReport(parsed, roles, colorMap, false);
  else screen.value = { name: 'colors', parsed, roles, colorMap, unmatched };
}

// Answers Adresses Québec gave in this session, by address: a report planned again asks nothing.
const answers = new Map<string, AddressCandidate[]>();
let stopping = false;

/** "Stop looking up": the report shows what was found so far. */
export function stopLookingUp(): void {
  stopping = true;
}

/**
 * The plan's houses with no position, found from their address where Terrain has a relay and the
 * switch in Settings is on. Only each house's street, town, postal code and province go online.
 */
async function findHouses(plan: ImportPlan): Promise<{ plan: ImportPlan; lookUp: LookUp }> {
  if (!hasRelay(location.hostname) || settings.value?.lookUpAddresses === false)
    return { plan, lookUp: null };
  const wanted = housesToFind(plan.merge.rows, plan.merge.houses, plan.campaign.roles);
  if (wanted.length === 0) return { plan, lookUp: null };
  const unknown = [...new Map(wanted.map(({ query }) => [addressKey(query), query])).entries()]
    .filter(([key]) => !answers.has(key))
    .map(([, query]) => query);
  let lookUp: LookUp = 'done';
  if (unknown.length > 0) {
    stopping = false;
    let done = 0;
    screen.value = { name: 'placing', total: unknown.length, done };
    try {
      await lookUpAddresses(
        unknown,
        (query, candidates) => {
          answers.set(addressKey(query), candidates);
          done += 1;
          screen.value = { name: 'placing', total: unknown.length, done };
        },
        () => stopping,
      );
      if (done < unknown.length) lookUp = 'stopped';
    } catch {
      lookUp = 'failed';
    }
  }
  const placements = new Map<string, Placement>();
  for (const { houseKey, query } of wanted) {
    const candidates = answers.get(addressKey(query));
    const placement = candidates ? placementFor(query, candidates) : null;
    if (placement) placements.set(houseKey, placement);
  }
  return { plan: withPlacements(plan, placements), lookUp };
}

export async function showReport(
  parsed: ParsedFile,
  roles: ColumnRoles,
  colorMap: Record<string, string>,
  asNewCampaign: boolean,
): Promise<void> {
  const target = asNewCampaign ? null : current.value;
  const planned = planImport({
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
  const { plan, lookUp } = await findHouses(planned);
  screen.value = { name: 'report', plan, saving: false, saveFailed: false, lookUp };
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
    void showReport(now.plan.parsed, now.plan.campaign.roles, now.plan.campaign.colorMap, true);
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

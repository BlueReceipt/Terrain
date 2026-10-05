import { signal } from '@preact/signals';
import type { Settings } from '../data/db.ts';
import {
  campaignEvents,
  deleteCampaign,
  listCampaigns,
  loadSettings,
  recordStoragePersistence,
  renameCampaign,
  saveSettings,
  setColumnGroups,
  setLotColumn,
  switchCampaign,
  type CampaignSummary,
} from '../data/repo.ts';
import type { Campaign } from '../domain/types.ts';
import { refreshPending } from './actions.ts';
import { current, database, events, screen, settings } from './flow.ts';
import { closeCard, panel, sheet, statusFilter } from './mapState.ts';

/** The status whose form is open in Settings: an edit in progress holds back the update prompt. */
export const editingStatus = signal<string | null>(null);

/** Every campaign on the phone (Settings → Campaign). */
export const campaigns = signal<CampaignSummary[]>([]);
/** How much the phone lets Terrain keep (Settings → Storage). */
export const storageState = signal<{
  persisted: boolean | null;
  usedBytes: number | null;
  quotaBytes: number | null;
  refused: boolean;
}>({ persisted: null, usedBytes: null, quotaBytes: null, refused: false });

export async function refreshCampaigns(): Promise<void> {
  const db = database();
  campaigns.value = db ? await listCampaigns(db) : [];
}

/** A change in Settings, saved at once. */
export async function updateSettings(
  change: Partial<
    Pick<
      Settings,
      'statuses' | 'callOutcomes' | 'dateFormat' | 'notesExportMode' | 'fillVisitDateViaLot'
    >
  >,
): Promise<void> {
  const db = database();
  if (!db) return;
  settings.value = await saveSettings(db, change);
}

export async function renameOpenCampaign(name: string): Promise<void> {
  const db = database();
  const loaded = current.value;
  const trimmed = name.trim();
  if (!db || !loaded || trimmed === '' || trimmed === loaded.campaign.name) return;
  current.value = { ...loaded, campaign: await renameCampaign(db, loaded.campaign.id, trimmed) };
  await refreshCampaigns();
}

/** Opens another campaign: its map, nothing selected; it opens on launch from now on. */
export async function openOtherCampaign(campaignId: string, show = true): Promise<void> {
  const db = database();
  if (!db) return;
  const loaded = await switchCampaign(db, campaignId);
  if (!loaded) return;
  closeCard();
  sheet.value = null;
  panel.value = null;
  statusFilter.value = null;
  current.value = loaded;
  events.value = await campaignEvents(db, campaignId);
  settings.value = await loadSettings(db);
  await refreshPending();
  await refreshCampaigns();
  if (show) screen.value = { name: 'campaign' };
}

/** Deletes a campaign after Alex confirms; the newest one left opens, or the home screen. */
export async function removeCampaign(campaignId: string): Promise<void> {
  const db = database();
  if (!db) return;
  const next = await deleteCampaign(db, campaignId);
  if (current.value?.campaign.id === campaignId) {
    if (next) {
      await openOtherCampaign(next, false);
    } else {
      closeCard();
      current.value = null;
      events.value = [];
      screen.value = { name: 'home' };
    }
  }
  settings.value = await loadSettings(db);
  await refreshCampaigns();
}

export async function regroupColumns(columnGroups: Campaign['columnGroups']): Promise<void> {
  const db = database();
  const loaded = current.value;
  if (!db || !loaded) return;
  current.value = {
    ...loaded,
    campaign: await setColumnGroups(db, loaded.campaign.id, columnGroups),
  };
}

/** Settings → Lots → Group rows into lots by: lots and houses recomputed on the spot. */
export async function regroupLots(lotColumn: string | null): Promise<void> {
  const db = database();
  const loaded = current.value;
  if (!db || !loaded) return;
  closeCard();
  current.value = await setLotColumn(db, loaded.campaign.id, lotColumn);
}

export async function refreshStorage(): Promise<void> {
  if (!('storage' in navigator)) return;
  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted(),
    navigator.storage.estimate(),
  ]);
  storageState.value = {
    ...storageState.value,
    persisted,
    usedBytes: estimate.usage ?? null,
    quotaBytes: estimate.quota ?? null,
  };
}

/** Settings → Storage → Keep Terrain's data: asks the browser not to clear it. */
export async function keepData(): Promise<void> {
  const db = database();
  if (!db || !('storage' in navigator)) return;
  const persisted = await navigator.storage.persist();
  await recordStoragePersistence(db, persisted);
  storageState.value = { ...storageState.value, persisted, refused: !persisted };
}

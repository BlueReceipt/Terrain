import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { campaignArea } from '../domain/pins.ts';
import { FilePicker } from './FilePicker.tsx';
import {
  backUp,
  basemap,
  basemapState,
  current,
  lastBackup,
  leaveImport,
  loadBasemap,
  unloadBasemap,
} from './flow.ts';
import { RestoreButton } from './ImportButton.tsx';
import {
  AboutSection,
  CallOutcomesSection,
  CampaignSection,
  ColumnsSection,
  DatesSection,
  LotsSection,
  StatusesSection,
  StorageSection,
} from './SettingsSections.tsx';
import { editingStatus } from './settingsActions.ts';
import { strings } from './strings.ts';

/** Settings → Offline map (§5.9): load or remove the map file; copy the campaign area for the script. */
function OfflineMap() {
  const copied = useSignal<'yes' | 'failed' | null>(null);
  const map = basemap.value;
  const state = basemapState.value;
  const area = campaignArea(current.value?.campaign.bounds ?? null);
  return (
    <section class="settings-section" aria-labelledby="offline-map">
      <h2 id="offline-map">{strings.settings.offlineMap}</h2>
      {map ? (
        <p>
          {strings.settings.mapInfo(map.info.name, (map.info.size / 1_048_576).toFixed(1))}
          <br />
          <span class="muted">{strings.settings.mapZooms(map.info.minZoom, map.info.maxZoom)}</span>
        </p>
      ) : (
        <p class="muted">{strings.settings.noMap}</p>
      )}
      {state.loading && <p role="status">{strings.settings.loadingMap}</p>}
      {state.error && (
        <p class="notice" role="alert">
          {strings.settings.mapErrors[state.error]}
        </p>
      )}
      <div class="settings-actions">
        <FilePicker
          label={strings.settings.loadMap}
          accept=".pmtiles,application/octet-stream"
          primary={!map}
          onFile={(file) => void loadBasemap(file)}
        />
        {map && (
          <button type="button" class="button" onClick={() => void unloadBasemap()}>
            {strings.settings.removeMap}
          </button>
        )}
      </div>
      <h3>{strings.settings.copyArea}</h3>
      {area ? (
        <>
          <p class="area">
            <code>{area}</code>
          </p>
          <p class="muted">{strings.settings.areaHelp}</p>
          <button
            type="button"
            class="button"
            onClick={() => {
              navigator.clipboard.writeText(area).then(
                () => {
                  copied.value = 'yes';
                },
                () => {
                  copied.value = 'failed';
                },
              );
            }}
          >
            {strings.settings.copyArea}
          </button>
          {copied.value && (
            <p role="status" class="muted">
              {copied.value === 'yes' ? strings.settings.copied : strings.settings.copyFailed}
            </p>
          )}
        </>
      ) : (
        <p class="muted">{strings.settings.noArea}</p>
      )}
    </section>
  );
}

/** Settings (§5.9), in the order of use: the campaign, how statuses and fields behave, files. */
export function SettingsScreen() {
  const loaded = current.value;
  const saved = lastBackup.value;
  // A status form left open doesn't hold the update prompt back once Settings closes.
  useEffect(
    () => () => {
      editingStatus.value = null;
    },
    [],
  );
  return (
    <main class="screen settings">
      <header class="settings-head">
        <button type="button" class="button" onClick={leaveImport}>
          ← {strings.settings.back}
        </button>
        <h1>{strings.settings.title}</h1>
      </header>
      {loaded && <CampaignSection key={loaded.campaign.id} />}
      <StatusesSection />
      {loaded && <ColumnsSection />}
      {loaded && <LotsSection />}
      <CallOutcomesSection />
      <DatesSection />
      <OfflineMap />
      <StorageSection />
      <section class="settings-section" aria-labelledby="backups">
        <h2 id="backups">{strings.settings.backups}</h2>
        <div class="settings-actions">
          <button type="button" class="button" onClick={() => void backUp()}>
            {strings.backup.backUp}
          </button>
          <RestoreButton />
        </div>
        {saved && (
          <p class="muted" role="status">
            {strings.backup.saved(saved)}
          </p>
        )}
      </section>
      <AboutSection />
    </main>
  );
}

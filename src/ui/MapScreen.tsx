import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { houseStatus, statusCounts } from '../domain/pins.ts';
import { search, type SearchResult } from '../domain/search.ts';
import { locationState, myFix, startLocating, stopLocating } from '../map/geolocation.ts';
import { MapView } from '../map/MapView.tsx';
import { freshPendingCall, refreshPending } from './actions.ts';
import { isPublicDemo } from './demo.ts';
import { DayLogPanel } from './DayLog.tsx';
import { ExportPanel } from './ExportPanel.tsx';
import { basemap, current, openSettings, statuses } from './flow.ts';
import { HouseCard } from './HouseCard.tsx';
import { addressOf, nameOf } from './rowText.ts';
import {
  chooserHouseKeys,
  closeCard,
  content,
  focus,
  focusOn,
  houseList,
  linked,
  panel,
  selectedHouseKey,
  selectedPinId,
  selectHouse,
  sheet,
  showUnplaced,
  statusFilter,
  tapPin,
} from './mapState.ts';
import { Sheets } from './Sheets.tsx';
import { strings } from './strings.ts';
import { Swatch } from './Swatch.tsx';
import { Toast } from './Toast.tsx';

/** The search field: parcel ID, owner, lot number, address and every other cell; corrections too. */
function SearchBox() {
  const query = useSignal('');
  const loaded = current.value;
  const results: SearchResult[] = loaded ? search(loaded.rows, loaded.campaign, query.value) : [];
  const choose = (result: SearchResult) => {
    query.value = '';
    if (result.kind === 'row') selectHouse(result.houseKey, result.rowId);
    else
      houseList.value = {
        title: strings.map.lotTitle(result.column, result.value),
        houseKeys: result.houseKeys,
      };
  };
  return (
    <div class="search" role="search">
      <input
        type="search"
        class="search-input"
        placeholder={strings.map.search}
        aria-label={strings.map.search}
        value={query.value}
        onInput={(event) => {
          query.value = event.currentTarget.value;
        }}
      />
      {query.value.trim().length >= 2 && (
        <ul class="search-results" aria-label={strings.map.search}>
          {results.length === 0 && <li class="muted">{strings.map.noResults}</li>}
          {results.map((result) => (
            <li key={result.kind === 'row' ? result.rowId : `${result.column}:${result.value}`}>
              <button
                type="button"
                class="result"
                onClick={() => {
                  choose(result);
                }}
              >
                {result.kind === 'row' ? (
                  // One run of text that wraps, not a column per part.
                  <span class="grow">
                    <span class="parcel">{result.parcelId}</span> {result.name || strings.noName}
                    <span class="muted"> {result.address}</span>
                    {result.cell && (
                      <span class="muted">
                        {' · '}
                        {result.cell.column}: {result.cell.value}
                      </span>
                    )}
                  </span>
                ) : (
                  strings.map.lotResult(result.column, result.value, result.houseKeys.length)
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Status filter chips: chip counts are rows; a filter shows houses with that status. */
function FilterChips() {
  const loaded = current.value;
  if (!loaded) return null;
  const counts = statusCounts(loaded.rows);
  const unplaced = content.value.unplaced;
  return (
    <div class="chips" role="toolbar" aria-label={strings.map.filters}>
      <button
        type="button"
        class="chip"
        aria-pressed={statusFilter.value === null}
        onClick={() => {
          statusFilter.value = null;
        }}
      >
        {strings.map.allStatuses}
      </button>
      {statuses.value
        .filter((status) => (counts.get(status.id) ?? 0) > 0)
        .map((status) => (
          <button
            key={status.id}
            type="button"
            class="chip"
            aria-pressed={statusFilter.value === status.id}
            onClick={() => {
              statusFilter.value = statusFilter.value === status.id ? null : status.id;
            }}
          >
            <Swatch color={status.color} />
            {strings.map.chip(status.label, counts.get(status.id) ?? 0)}
          </button>
        ))}
      {unplaced.length > 0 && (
        <button
          type="button"
          class="chip"
          onClick={() => {
            showUnplaced(strings.map.notOnMapTitle, unplaced);
          }}
        >
          {strings.map.notOnMap(unplaced.length)}
        </button>
      )}
    </div>
  );
}

/** A list of houses over the map: a shared spot's chooser, the houses of a lot, or those with no position. */
function HouseSheet({
  title,
  help,
  houseKeys,
  onClose,
}: {
  title: string;
  help: string | null;
  houseKeys: readonly string[];
  onClose: () => void;
}) {
  const loaded = current.value;
  if (!loaded) return null;
  const { roles } = loaded.campaign;
  return (
    <section class="sheet" aria-label={title}>
      <header class="card-head">
        <h2 class="sheet-title">{title}</h2>
        <button type="button" class="icon-button" aria-label={strings.map.close} onClick={onClose}>
          ✕
        </button>
      </header>
      {help && <p class="muted">{help}</p>}
      <ul class="sheet-list">
        {houseKeys.map((key) => {
          const rows = loaded.rows.filter((row) => row.houseKey === key);
          const status = houseStatus(rows, statuses.value);
          return (
            <li key={key}>
              <button
                type="button"
                class="result"
                onClick={() => {
                  selectHouse(key);
                }}
              >
                <Swatch color={status.color} />
                <span class="grow">
                  <span class="strong">{addressOf(rows, roles)}</span>
                  <span class="muted">
                    {' '}
                    {[...new Set(rows.map((row) => nameOf(row, roles)))].join(', ')} ·{' '}
                    {strings.card.rows(rows.length)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The home screen of an open campaign: the map, its pins, search, filters, the house card. */
export function MapScreen() {
  const loaded = current.value;
  const askedWhere = useSignal(false);

  useEffect(() => {
    // GPS while the map is on screen only. Back from the dialer, the call's outcome.
    const follow = () => {
      if (document.visibilityState !== 'visible') {
        stopLocating();
        return;
      }
      startLocating();
      void refreshPending().then(() => {
        const call = freshPendingCall();
        if (!call || sheet.value) return;
        selectHouse(call.houseKey);
        sheet.value = {
          kind: 'outcome',
          houseKey: call.houseKey,
          pendingId: call.id,
          number: call.number,
        };
      });
    };
    follow();
    document.addEventListener('visibilitychange', follow);
    return () => {
      document.removeEventListener('visibilitychange', follow);
      stopLocating();
    };
  }, []);

  if (!loaded) return null;
  // The public demo draws OpenFreeMap's map while online, so it needs no offline map.
  const demo = isPublicDemo(location.hostname);
  const fix = myFix.value;
  const selected = selectedHouseKey.value;
  const chooser = chooserHouseKeys.value;
  const list = houseList.value;
  const located = locationState.value;

  return (
    <main class="map-screen">
      <MapView
        basemapUrl={basemap.value?.url ?? null}
        online={demo}
        bounds={loaded.campaign.bounds}
        pins={content.value.pins}
        reference={loaded.campaign.reference}
        selectedPinId={selectedPinId.value}
        linkedPinIds={linked.value.pinIds}
        tetherFrom={linked.value.from}
        tetherTo={linked.value.to}
        me={fix ? { position: fix.position, accuracyM: fix.accuracyM } : null}
        focus={focus.value}
        onTapPin={tapPin}
        onTapMap={() => {
          closeCard();
          chooserHouseKeys.value = null;
        }}
        label={strings.map.label}
      />
      <header class="map-top">
        <SearchBox />
        <button
          type="button"
          class="icon-button map-button"
          aria-label={strings.map.locate}
          onClick={() => {
            startLocating();
            askedWhere.value = true;
            if (fix) focusOn(fix.position);
          }}
        >
          ◎
        </button>
        <button
          type="button"
          class="icon-button map-button"
          aria-label={strings.map.menu}
          onClick={openSettings}
        >
          ☰
        </button>
      </header>
      {!basemap.value && !demo && (
        <button type="button" class="banner" onClick={openSettings}>
          {strings.map.noBasemap}
        </button>
      )}
      {askedWhere.value && !fix && located !== 'on' && (
        // Only after a tap on "Show where I am": a refusal shouldn't cover the map all day.
        <button
          type="button"
          class="banner"
          role="status"
          onClick={() => {
            askedWhere.value = false;
          }}
        >
          {located === 'denied' || located === 'unavailable'
            ? strings.map.locationDenied
            : strings.map.locationWaiting}
        </button>
      )}
      <div class="map-bottom">
        {chooser ? (
          <HouseSheet
            title={strings.map.chooserTitle(chooser.length)}
            help={strings.map.chooserHelp}
            houseKeys={chooser}
            onClose={() => {
              chooserHouseKeys.value = null;
            }}
          />
        ) : list ? (
          <HouseSheet
            title={list.title}
            help={list.title === strings.map.notOnMapTitle ? strings.map.notOnMapHelp : null}
            houseKeys={list.houseKeys}
            onClose={() => {
              houseList.value = null;
            }}
          />
        ) : selected ? (
          <HouseCard houseKey={selected} />
        ) : (
          <div class="bottom-row">
            <button
              type="button"
              class="day-log-button"
              onClick={() => {
                panel.value = 'dayLog';
              }}
            >
              {strings.dayLog.open}
            </button>
            <FilterChips />
          </div>
        )}
      </div>
      {panel.value === 'dayLog' && <DayLogPanel />}
      {panel.value === 'export' && <ExportPanel />}
      <Toast />
      <Sheets />
    </main>
  );
}

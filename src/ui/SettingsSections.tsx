import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ulid } from 'ulid';
import { APP_ROLES } from '../domain/columns.ts';
import { formatDay } from '../domain/daylog.ts';
import { editableColumns } from '../domain/editLayout.ts';
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatTime } from '../domain/format.ts';
import { lotsAcrossHouses } from '../domain/identity.ts';
import { mapContent } from '../domain/pins.ts';
import {
  addStatus,
  editStatus,
  isHexColor,
  lotBehaviorOf,
  lotFields,
  moveStatus,
  type LotBehavior,
} from '../domain/statuses.ts';
import type { ColumnGroup, Status } from '../domain/types.ts';
import { isPublicDemo } from './demo.ts';
import { current, settings, statuses } from './flow.ts';
import { ImportButton } from './ImportButton.tsx';
import { MyMapsLink } from './MyMapsLink.tsx';
import { hasRelay } from './online.ts';
import {
  campaigns,
  editingStatus,
  keepData,
  openOtherCampaign,
  refreshCampaigns,
  refreshStorage,
  regroupColumns,
  regroupLots,
  removeCampaign,
  renameOpenCampaign,
  storageState,
  updateSettings,
} from './settingsActions.ts';
import { strings } from './strings.ts';
import { Swatch } from './Swatch.tsx';

const words = strings.settings;

/** Campaign: rename, its summary, import into it (on the demo, a My Maps link too), switch, delete. */
export function CampaignSection() {
  const loaded = current.value;
  const name = useSignal(loaded?.campaign.name ?? '');
  const confirming = useSignal(false);
  useEffect(() => {
    void refreshCampaigns();
  }, []);
  if (!loaded) return null;
  const { campaign, rows } = loaded;
  const others = campaigns.value.filter((other) => other.id !== campaign.id);
  const renamed = name.value.trim();
  return (
    <section class="settings-section" aria-labelledby="campaign">
      <h2 id="campaign">{words.campaign}</h2>
      <label class="field">
        {words.campaignName}
        <input
          class="text-input"
          value={name.value}
          onInput={(event) => {
            name.value = event.currentTarget.value;
          }}
        />
      </label>
      <div class="settings-actions">
        <button
          type="button"
          class="button"
          disabled={renamed === '' || renamed === campaign.name}
          onClick={() => void renameOpenCampaign(renamed)}
        >
          {words.rename}
        </button>
      </div>
      <p>{strings.campaign.summary(rows.length, new Set(rows.map((row) => row.houseKey)).size)}</p>
      <ul class="list facts">
        <li>{strings.campaign.noPosition(mapContent(rows, statuses.value).unplaced.length)}</li>
        <li>{strings.campaign.lots(lotsAcrossHouses(rows).length)}</li>
      </ul>
      <div class="settings-actions">
        <ImportButton label={strings.campaign.importFile} primary={false} />
        {isPublicDemo(location.hostname) && <MyMapsLink />}
      </div>
      {others.length > 0 && (
        <>
          <h3>{words.otherCampaigns}</h3>
          <ul class="sheet-list">
            {others.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  class="result"
                  aria-label={words.openCampaign(other.name)}
                  onClick={() => void openOtherCampaign(other.id)}
                >
                  {words.campaignRows(other.name, other.rows)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {confirming.value ? (
        <div class="confirm" role="group" aria-labelledby="delete-title">
          <p id="delete-title" class="strong">
            {words.deleteTitle(campaign.name)}
          </p>
          <p>{words.deleteBody(rows.length)}</p>
          <div class="settings-actions">
            <button
              type="button"
              class="button primary"
              onClick={() => void removeCampaign(campaign.id)}
            >
              {words.deleteConfirm}
            </button>
            <button
              type="button"
              class="button"
              onClick={() => {
                confirming.value = false;
              }}
            >
              {strings.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div class="settings-actions">
          <button
            type="button"
            class="button"
            onClick={() => {
              confirming.value = true;
            }}
          >
            {words.deleteCampaign}
          </button>
        </div>
      )}
    </section>
  );
}

const BEHAVIORS: readonly LotBehavior[] = ['house', 'closes', 'notes'];

/** One status's form. To visit keeps its part: only its label and color change. */
function StatusForm({ status, onDone }: { status: Status; onDone: () => void }) {
  const draft = useSignal({
    label: status.label,
    color: status.color,
    packageStatusText: status.packageStatusText,
    behavior: lotBehaviorOf(status),
    replaceableByLot: status.replaceableByLot,
    asksForNote: status.asksForNote,
    onRail: status.onRail,
  });
  const value = draft.value;
  const set = (change: Partial<typeof value>) => {
    draft.value = { ...draft.value, ...change };
  };
  const colorOk = isHexColor(value.color);
  const labelOk = value.label.trim() !== '';
  const start = status.isStartStatus;
  const save = async () => {
    if (!colorOk || !labelOk) return;
    await updateSettings({
      statuses: editStatus(statuses.value, status.id, {
        label: value.label.trim(),
        color: value.color,
        packageStatusText: value.packageStatusText,
        ...lotFields(value.behavior),
        replaceableByLot: value.replaceableByLot,
        asksForNote: value.asksForNote,
        onRail: value.onRail,
      }),
    });
    onDone();
  };
  return (
    <form
      class="status-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {start && <p class="muted">{words.startStatus}</p>}
      <label class="field">
        {words.label}
        <input
          class="text-input"
          value={value.label}
          onInput={(event) => {
            set({ label: event.currentTarget.value });
          }}
        />
      </label>
      {!labelOk && (
        <p class="notice" role="alert">
          {words.needLabel}
        </p>
      )}
      <label class="field">
        {words.color}
        <span class="color-field">
          <Swatch color={colorOk ? value.color : '#FFFFFF'} />
          <input
            class="text-input"
            value={value.color}
            spellcheck={false}
            autoCapitalize="characters"
            onInput={(event) => {
              set({ color: event.currentTarget.value.trim() });
            }}
          />
        </span>
      </label>
      {!colorOk && (
        <p class="notice" role="alert">
          {words.badColor}
        </p>
      )}
      {!start && (
        <>
          <label class="field">
            {words.packageText}
            <input
              class="text-input"
              value={value.packageStatusText}
              onInput={(event) => {
                set({ packageStatusText: event.currentTarget.value });
              }}
            />
          </label>
          <fieldset class="choices">
            <legend>{words.lotBehavior}</legend>
            {BEHAVIORS.map((behavior) => (
              <label key={behavior} class="check">
                <input
                  type="radio"
                  name={`lot-${status.id}`}
                  checked={value.behavior === behavior}
                  onChange={() => {
                    set({ behavior });
                  }}
                />
                {words.lotBehaviors[behavior]}
              </label>
            ))}
          </fieldset>
          <label class="check">
            <input
              type="checkbox"
              checked={value.replaceableByLot}
              onChange={(event) => {
                set({ replaceableByLot: event.currentTarget.checked });
              }}
            />
            {words.replaceable}
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.asksForNote}
              onChange={(event) => {
                set({ asksForNote: event.currentTarget.checked });
              }}
            />
            {words.asksForNote}
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.onRail}
              onChange={(event) => {
                set({ onRail: event.currentTarget.checked });
              }}
            />
            {words.onRail}
          </label>
        </>
      )}
      <div class="settings-actions">
        <button type="submit" class="button primary" disabled={!colorOk || !labelOk}>
          {words.save}
        </button>
        <button type="button" class="button" onClick={onDone}>
          {strings.cancel}
        </button>
        {!start && (
          <button
            type="button"
            class="button"
            onClick={() => {
              void updateSettings({
                statuses: editStatus(statuses.value, status.id, { archived: !status.archived }),
              }).then(onDone);
            }}
          >
            {status.archived ? words.restore : words.archive}
          </button>
        )}
      </div>
    </form>
  );
}

/** Statuses: edit, reorder, add, archive. A status in use is never deleted. */
export function StatusesSection() {
  const editing = editingStatus;
  const all = [...statuses.value].sort((a, b) => a.order - b.order);
  const save = (next: Status[]) => void updateSettings({ statuses: next });
  return (
    <section class="settings-section" aria-labelledby="statuses">
      <h2 id="statuses">{words.statuses}</h2>
      <p class="muted">{words.statusesHelp}</p>
      <ul class="status-list">
        {all.map((status, i) => {
          const open = editing.value === status.id;
          const notes = [
            ...(status.archived ? [words.archived] : []),
            ...(!status.onRail && !status.isStartStatus ? [words.notOnRail] : []),
          ];
          return (
            <li key={status.id}>
              <div class="status-item">
                <Swatch color={status.color} />
                <span class="grow">
                  <span class="strong">{status.label}</span>
                  {notes.length > 0 && <span class="muted"> · {notes.join(', ')}</span>}
                </span>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={words.moveUp(status.label)}
                  disabled={i === 0}
                  onClick={() => {
                    save(moveStatus(all, status.id, -1));
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={words.moveDown(status.label)}
                  disabled={i === all.length - 1}
                  onClick={() => {
                    save(moveStatus(all, status.id, 1));
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="button"
                  aria-label={words.editStatus(status.label)}
                  aria-expanded={open}
                  onClick={() => {
                    editing.value = open ? null : status.id;
                  }}
                >
                  {strings.edit.editShort}
                </button>
              </div>
              {open && (
                <StatusForm
                  status={status}
                  onDone={() => {
                    editing.value = null;
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div class="settings-actions">
        <button
          type="button"
          class="button"
          onClick={() => {
            const id = ulid();
            save(addStatus(all, id, words.newStatus, '#757575'));
            editing.value = id;
          }}
        >
          {words.addStatus}
        </button>
      </div>
    </section>
  );
}

const GROUPS: readonly ColumnGroup[] = ['house', 'parcel', 'person'];

/** Columns: how Edit info shows each column. */
export function ColumnsSection() {
  const loaded = current.value;
  if (!loaded) return null;
  const { campaign } = loaded;
  return (
    <section class="settings-section" aria-labelledby="columns">
      <h2 id="columns">{words.columns}</h2>
      <p class="muted">{words.columnsHelp}</p>
      <ul class="column-list">
        {editableColumns(campaign).map(({ column, group }) => (
          <li key={column}>
            <label class="column-choice">
              <span class="grow">{column}</span>
              <select
                value={group}
                onChange={(event) => {
                  const chosen = GROUPS.find(
                    (candidate) => candidate === event.currentTarget.value,
                  );
                  if (chosen) void regroupColumns({ ...campaign.columnGroups, [column]: chosen });
                }}
              >
                {GROUPS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {words.groups[candidate]}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Lots: the column rows are grouped into lots by; Visit date on rows closed from the lot. */
export function LotsSection() {
  const loaded = current.value;
  const saved = settings.value;
  if (!loaded || !saved) return null;
  const { campaign, rows } = loaded;
  const appColumns = new Set(APP_ROLES.map((role) => campaign.roles[role]));
  const columns = campaign.columnOrder.filter((column) => !appColumns.has(column));
  return (
    <section class="settings-section" aria-labelledby="lots">
      <h2 id="lots">{words.lots}</h2>
      <label class="field">
        {words.lotColumn}
        <select
          value={campaign.lotColumn ?? ''}
          onChange={(event) => void regroupLots(event.currentTarget.value || null)}
        >
          <option value="">{words.parcelIdColumn}</option>
          {columns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
      </label>
      <p class="muted">{words.lotsAcross(lotsAcrossHouses(rows).length)}</p>
      <label class="check">
        <input
          type="checkbox"
          checked={saved.fillVisitDateViaLot}
          onChange={(event) =>
            void updateSettings({ fillVisitDateViaLot: event.currentTarget.checked })
          }
        />
        {words.lotVisitDate}
      </label>
    </section>
  );
}

/**
 * What may go online, where Terrain has a relay (src/ui/online.ts): each house's address to find
 * it, and the map area on screen for streets. Nothing else ever leaves the phone.
 */
export function OnlineSection() {
  const saved = settings.value;
  if (!saved || !hasRelay(location.hostname)) return null;
  return (
    <section class="settings-section" aria-labelledby="online">
      <h2 id="online">{words.online}</h2>
      <p class="muted">{words.onlineIntro}</p>
      <label class="check">
        <input
          type="checkbox"
          checked={saved.lookUpAddresses}
          aria-describedby="look-up-help"
          onChange={(event) =>
            void updateSettings({ lookUpAddresses: event.currentTarget.checked })
          }
        />
        {words.lookUpAddresses}
      </label>
      <p id="look-up-help" class="muted">
        {words.lookUpAddressesHelp}
      </p>
      <label class="check">
        <input
          type="checkbox"
          checked={saved.onlineMap}
          aria-describedby="online-map-help"
          onChange={(event) => void updateSettings({ onlineMap: event.currentTarget.checked })}
        />
        {words.onlineMap}
      </label>
      <p id="online-map-help" class="muted">
        {words.onlineMapHelp}
      </p>
    </section>
  );
}

/** Call outcomes: the buttons after a call, in order. */
export function CallOutcomesSection() {
  const saved = settings.value;
  if (!saved) return null;
  const outcomes = saved.callOutcomes;
  const save = (next: string[]) => void updateSettings({ callOutcomes: next });
  return (
    <section class="settings-section" aria-labelledby="call-outcomes">
      <h2 id="call-outcomes">{words.callOutcomes}</h2>
      <p class="muted">{words.callOutcomesHelp}</p>
      <ol class="outcome-list">
        {outcomes.map((outcome, i) => (
          <li key={`${String(i)}:${outcome}`} class="outcome-item">
            <input
              class="text-input"
              aria-label={words.outcome(i + 1)}
              value={outcome}
              onChange={(event) => {
                const text = event.currentTarget.value.trim();
                if (text) save(outcomes.map((other, k) => (k === i ? text : other)));
              }}
            />
            <button
              type="button"
              class="icon-button"
              aria-label={words.moveOutcomeUp(outcome)}
              disabled={i === 0}
              onClick={() => {
                const next = [...outcomes];
                next.splice(i - 1, 2, outcome, outcomes[i - 1] ?? outcome);
                save(next);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              class="icon-button"
              aria-label={words.removeOutcome(outcome)}
              disabled={outcomes.length === 1}
              onClick={() => {
                save(outcomes.filter((_, k) => k !== i));
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
      <div class="settings-actions">
        <button
          type="button"
          class="button"
          onClick={() => {
            save([...outcomes, words.newOutcome]);
          }}
        >
          {words.addOutcome}
        </button>
      </div>
    </section>
  );
}

/** Dates and notes: the date format Terrain writes, and the Notes cell of the export. */
export function DatesSection() {
  const saved = settings.value;
  if (!saved) return null;
  const sample = '2026-09-26T14:32:00-04:00';
  const modes = ['joined', 'latest'] as const;
  return (
    <section class="settings-section" aria-labelledby="dates">
      <h2 id="dates">{words.datesAndNotes}</h2>
      <fieldset class="choices">
        <legend>{words.dateFormat}</legend>
        {DATE_FORMATS.map((format) => (
          <label key={format} class="check">
            <input
              type="radio"
              name="date-format"
              checked={saved.dateFormat === format}
              onChange={() => void updateSettings({ dateFormat: format })}
            />
            {formatTime(sample, format)}
          </label>
        ))}
      </fieldset>
      <fieldset class="choices">
        <legend>{words.notesInExport}</legend>
        {modes.map((mode) => (
          <label key={mode} class="check">
            <input
              type="radio"
              name="notes-mode"
              checked={saved.notesExportMode === mode}
              onChange={() => void updateSettings({ notesExportMode: mode })}
            />
            {words.notesModes[mode]}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function size(bytes: number): string {
  const megabytes = bytes / 1_048_576;
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`;
  return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`;
}

/** Storage: whether the browser keeps Terrain's data, and the space used. */
export function StorageSection() {
  useEffect(() => {
    void refreshStorage();
  }, []);
  const state = storageState.value;
  return (
    <section class="settings-section" aria-labelledby="storage">
      <h2 id="storage">{words.storage}</h2>
      <p>{state.persisted ? words.persisted : words.notPersisted}</p>
      {state.persisted === false && (
        <div class="settings-actions">
          <button type="button" class="button" onClick={() => void keepData()}>
            {words.keepData}
          </button>
        </div>
      )}
      {state.refused && (
        <p class="notice" role="alert">
          {words.keepRefused}
        </p>
      )}
      {state.usedBytes !== null && state.quotaBytes !== null && (
        <p class="muted">{words.used(size(state.usedBytes), size(state.quotaBytes))}</p>
      )}
    </section>
  );
}

/** About: version and build date. */
export function AboutSection() {
  const format = settings.value?.dateFormat ?? DEFAULT_DATE_FORMAT;
  return (
    <section class="settings-section" aria-labelledby="about">
      <h2 id="about">{words.about}</h2>
      <p>{words.version(__TERRAIN_VERSION__, formatDay(__TERRAIN_BUILT__, format))}</p>
    </section>
  );
}

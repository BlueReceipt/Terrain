import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ulid } from 'ulid';
import { APP_ROLES } from '../domain/columns.ts';
import { formatDay } from '../domain/daylog.ts';
import { editableColumns } from '../domain/editLayout.ts';
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatTime } from '../domain/format.ts';
import { lotNumberColumns, lotsAcrossHouses } from '../domain/identity.ts';
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
import { language, strings } from './strings.ts';
import { Swatch } from './Swatch.tsx';

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
      <h2 id="campaign">{strings.settings.campaign}</h2>
      <label class="field">
        {strings.settings.campaignName}
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
          {strings.settings.rename}
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
          <h3>{strings.settings.otherCampaigns}</h3>
          <ul class="sheet-list">
            {others.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  class="result"
                  aria-label={strings.settings.openCampaign(other.name)}
                  onClick={() => void openOtherCampaign(other.id)}
                >
                  {strings.settings.campaignRows(other.name, other.rows)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {confirming.value ? (
        <div class="confirm" role="group" aria-labelledby="delete-title">
          <p id="delete-title" class="strong">
            {strings.settings.deleteTitle(campaign.name)}
          </p>
          <p>{strings.settings.deleteBody(rows.length)}</p>
          <div class="settings-actions">
            <button
              type="button"
              class="button primary"
              onClick={() => void removeCampaign(campaign.id)}
            >
              {strings.settings.deleteConfirm}
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
            {strings.settings.deleteCampaign}
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
      {start && <p class="muted">{strings.settings.startStatus}</p>}
      <label class="field">
        {strings.settings.label}
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
          {strings.settings.needLabel}
        </p>
      )}
      <label class="field">
        {strings.settings.color}
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
          {strings.settings.badColor}
        </p>
      )}
      {!start && (
        <>
          <label class="field">
            {strings.settings.packageText}
            <input
              class="text-input"
              value={value.packageStatusText}
              onInput={(event) => {
                set({ packageStatusText: event.currentTarget.value });
              }}
            />
          </label>
          <fieldset class="choices">
            <legend>{strings.settings.lotBehavior}</legend>
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
                {strings.settings.lotBehaviors[behavior]}
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
            {strings.settings.replaceable}
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.asksForNote}
              onChange={(event) => {
                set({ asksForNote: event.currentTarget.checked });
              }}
            />
            {strings.settings.asksForNote}
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={value.onRail}
              onChange={(event) => {
                set({ onRail: event.currentTarget.checked });
              }}
            />
            {strings.settings.onRail}
          </label>
        </>
      )}
      <div class="settings-actions">
        <button type="submit" class="button primary" disabled={!colorOk || !labelOk}>
          {strings.settings.save}
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
            {status.archived ? strings.settings.restore : strings.settings.archive}
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
      <h2 id="statuses">{strings.settings.statuses}</h2>
      <p class="muted">{strings.settings.statusesHelp}</p>
      <ul class="status-list">
        {all.map((status, i) => {
          const open = editing.value === status.id;
          const notes = [
            ...(status.archived ? [strings.settings.archived] : []),
            ...(!status.onRail && !status.isStartStatus ? [strings.settings.notOnRail] : []),
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
                  aria-label={strings.settings.moveUp(status.label)}
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
                  aria-label={strings.settings.moveDown(status.label)}
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
                  aria-label={strings.settings.editStatus(status.label)}
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
            save(addStatus(all, id, strings.settings.newStatus, '#757575'));
            editing.value = id;
          }}
        >
          {strings.settings.addStatus}
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
      <h2 id="columns">{strings.settings.columns}</h2>
      <p class="muted">{strings.settings.columnsHelp}</p>
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
                    {strings.settings.groups[candidate]}
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
      <h2 id="lots">{strings.settings.lots}</h2>
      <label class="field">
        {strings.settings.lotColumn}
        <select
          value={campaign.lotColumn ?? ''}
          onChange={(event) => void regroupLots(event.currentTarget.value || null)}
        >
          <option value="">
            {strings.settings.parcelIdColumn(lotNumberColumns(campaign.columnOrder)[0])}
          </option>
          {columns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
      </label>
      <p class="muted">{strings.settings.lotsAcross(lotsAcrossHouses(rows).length)}</p>
      <label class="check">
        <input
          type="checkbox"
          checked={saved.fillVisitDateViaLot}
          onChange={(event) =>
            void updateSettings({ fillVisitDateViaLot: event.currentTarget.checked })
          }
        />
        {strings.settings.lotVisitDate}
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
      <h2 id="online">{strings.settings.online}</h2>
      <p class="muted">{strings.settings.onlineIntro}</p>
      <label class="check">
        <input
          type="checkbox"
          checked={saved.lookUpAddresses}
          aria-describedby="look-up-help"
          onChange={(event) =>
            void updateSettings({ lookUpAddresses: event.currentTarget.checked })
          }
        />
        {strings.settings.lookUpAddresses}
      </label>
      <p id="look-up-help" class="muted">
        {strings.settings.lookUpAddressesHelp}
      </p>
      <label class="check">
        <input
          type="checkbox"
          checked={saved.onlineMap}
          aria-describedby="online-map-help"
          onChange={(event) => void updateSettings({ onlineMap: event.currentTarget.checked })}
        />
        {strings.settings.onlineMap}
      </label>
      <p id="online-map-help" class="muted">
        {strings.settings.onlineMapHelp}
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
      <h2 id="call-outcomes">{strings.settings.callOutcomes}</h2>
      <p class="muted">{strings.settings.callOutcomesHelp}</p>
      <ol class="outcome-list">
        {outcomes.map((outcome, i) => (
          <li key={`${String(i)}:${outcome}`} class="outcome-item">
            <input
              class="text-input"
              aria-label={strings.settings.outcome(i + 1)}
              value={outcome}
              onChange={(event) => {
                const text = event.currentTarget.value.trim();
                if (text) save(outcomes.map((other, k) => (k === i ? text : other)));
              }}
            />
            <button
              type="button"
              class="icon-button"
              aria-label={strings.settings.moveOutcomeUp(outcome)}
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
              aria-label={strings.settings.removeOutcome(outcome)}
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
            save([...outcomes, strings.settings.newOutcome]);
          }}
        >
          {strings.settings.addOutcome}
        </button>
      </div>
    </section>
  );
}

/**
 * Language (Alex, 2026-10-06): the screens in English or in French; until one is chosen, the
 * phone's. The files for the client stay in English.
 */
export function LanguageSection() {
  const languages = ['en', 'fr'] as const;
  return (
    <section class="settings-section" aria-labelledby="language">
      <h2 id="language">{strings.settings.language}</h2>
      <fieldset class="choices">
        <legend class="visually-hidden">{strings.settings.language}</legend>
        {languages.map((choice) => (
          <label key={choice} class="check" lang={choice}>
            <input
              type="radio"
              name="language"
              checked={language.value === choice}
              onChange={() => void updateSettings({ language: choice })}
            />
            {strings.settings.languages[choice]}
          </label>
        ))}
      </fieldset>
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
      <h2 id="dates">{strings.settings.datesAndNotes}</h2>
      <fieldset class="choices">
        <legend>{strings.settings.dateFormat}</legend>
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
        <legend>{strings.settings.notesInExport}</legend>
        {modes.map((mode) => (
          <label key={mode} class="check">
            <input
              type="radio"
              name="notes-mode"
              checked={saved.notesExportMode === mode}
              onChange={() => void updateSettings({ notesExportMode: mode })}
            />
            {strings.settings.notesModes[mode]}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

/** Storage: whether the browser keeps Terrain's data, and the space used. */
export function StorageSection() {
  useEffect(() => {
    void refreshStorage();
  }, []);
  const state = storageState.value;
  return (
    <section class="settings-section" aria-labelledby="storage">
      <h2 id="storage">{strings.settings.storage}</h2>
      <p>{state.persisted ? strings.settings.persisted : strings.settings.notPersisted}</p>
      {state.persisted === false && (
        <div class="settings-actions">
          <button type="button" class="button" onClick={() => void keepData()}>
            {strings.settings.keepData}
          </button>
        </div>
      )}
      {state.refused && (
        <p class="notice" role="alert">
          {strings.settings.keepRefused}
        </p>
      )}
      {state.usedBytes !== null && state.quotaBytes !== null && (
        <p class="muted">
          {strings.settings.used(
            strings.settings.size(state.usedBytes),
            strings.settings.size(state.quotaBytes),
          )}
        </p>
      )}
    </section>
  );
}

const SOURCE_CODE = 'https://github.com/BlueReceipt/Terrain';
const CONTACT = 'alex@ederer.digital';

/** About: version and build date, who made Terrain, its license and code, and where to write. */
export function AboutSection() {
  const format = settings.value?.dateFormat ?? DEFAULT_DATE_FORMAT;
  return (
    <section class="settings-section" aria-labelledby="about">
      <h2 id="about">{strings.settings.about}</h2>
      <p>{strings.settings.version(__TERRAIN_VERSION__, formatDay(__TERRAIN_BUILT__, format))}</p>
      <p>{strings.settings.madeBy}</p>
      <p>{strings.settings.license}</p>
      <a class="link-button" href={SOURCE_CODE} target="_blank" rel="noopener noreferrer">
        {SOURCE_CODE.replace('https://', '')}
      </a>
      <p>{strings.settings.questions}</p>
      <a class="link-button" href={`mailto:${CONTACT}`}>
        {CONTACT}
      </a>
    </section>
  );
}

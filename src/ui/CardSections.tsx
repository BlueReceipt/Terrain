import { useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { houseNumbers } from '../domain/calls.ts';
import { editLayout, type LayoutField } from '../domain/editLayout.ts';
import { DEFAULT_DATE_FORMAT, formatTime } from '../domain/format.ts';
import { housesOfRows, metersBetween } from '../domain/identity.ts';
import { notesByRow, type Note } from '../domain/notes.ts';
import { lotNeighbors } from '../domain/pins.ts';
import type { Row } from '../domain/types.ts';
import { dial } from './actions.ts';
import { current, events, settings, statuses } from './flow.ts';
import { numberText, StatusChip } from './StatusChip.tsx';
import { closeCard, focusOn, selectHouse, sheet } from './mapState.ts';
import { addressOf, nameOf } from './rowText.ts';
import { strings } from './strings.ts';

/** One field as the full view shows it: "No value" when blank, an edited mark showing the imported value. */
function FieldValue({ field, rows }: { field: LayoutField; rows: readonly Row[] }) {
  const showImported = useSignal(false);
  const imported =
    rows.find((row) => row.rowId === field.rowIds[0])?.sourceFields[field.column] ?? '';
  return (
    <div class="field-view">
      <dt>
        {field.column}
        {field.differs && <span class="muted"> ({strings.edit.differs})</span>}
      </dt>
      <dd>
        {field.edited ? (
          <button
            type="button"
            class="edited-value"
            aria-pressed={showImported.value}
            onClick={() => {
              showImported.value = !showImported.value;
            }}
          >
            <span>{field.value || <span class="muted">{strings.card.noValue}</span>}</span>
            <span class="mark">{strings.card.edited}</span>
            {showImported.value && <span class="muted">{strings.card.imported(imported)}</span>}
          </button>
        ) : (
          field.value || <span class="muted">{strings.card.noValue}</span>
        )}
      </dd>
    </div>
  );
}

/** The house's fields, grouped the way Edit info groups them (§5.3 full view). */
export function FieldsView({ rows }: { rows: readonly Row[] }) {
  const loaded = current.value;
  if (!loaded) return null;
  const layout = editLayout(rows, loaded.campaign);
  return (
    <section class="card-section" aria-label={strings.card.fields}>
      <h3>{strings.card.fields}</h3>
      {layout.house.length > 0 && (
        <dl class="fields">
          {layout.house.map((field) => (
            <FieldValue key={`${field.column}:${field.rowIds.join()}`} field={field} rows={rows} />
          ))}
        </dl>
      )}
      {layout.people.map((owner) => (
        <div key={owner.rowIds.join()}>
          <h4>{owner.name || strings.noName}</h4>
          <dl class="fields">
            {owner.fields.map((field) => (
              <FieldValue
                key={`${field.column}:${field.rowIds.join()}`}
                field={field}
                rows={rows}
              />
            ))}
          </dl>
        </div>
      ))}
      {layout.parcels.map((parcel) => (
        <div key={parcel.rowIds.join()}>
          <h4>{strings.edit.parcel(parcel.parcelId)}</h4>
          <dl class="fields">
            {parcel.fields.map((field) => (
              <FieldValue
                key={`${field.column}:${field.rowIds.join()}`}
                field={field}
                rows={rows}
              />
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}

/**
 * Same parcel at other addresses (§5.10): each other house on this house's lots, every row there
 * with its status and where it came from, their numbers, Open and Show on map. Houses a whole-lot
 * status can still change come first, then the nearest.
 */
export function LotSection({ houseKey }: { houseKey: string }) {
  const loaded = current.value;
  if (!loaded) return null;
  const { campaign } = loaded;
  const { roles } = campaign;
  const own = loaded.rows.filter((row) => row.houseKey === houseKey);
  const here = housesOfRows(own)[0]?.position ?? null;
  const replaceable = new Set(
    statuses.value.filter((status) => status.replaceableByLot).map((status) => status.id),
  );
  const others = lotNeighbors(loaded.rows, houseKey).map((otherKey) => {
    const all = loaded.rows.filter((row) => row.houseKey === otherKey);
    const position = housesOfRows(all)[0]?.position ?? null;
    return {
      houseKey: otherKey,
      rows: all,
      address: addressOf(all, roles),
      position,
      distance: here && position ? metersBetween(here, position) : null,
      open: all.some((row) => replaceable.has(row.statusId)),
      numbers: houseNumbers(all, campaign.columnOrder, roles, (row) => nameOf(row, roles)),
    };
  });
  if (others.length === 0) return null;
  others.sort(
    (a, b) =>
      Number(b.open) - Number(a.open) || (a.distance ?? Infinity) - (b.distance ?? Infinity),
  );
  const originOf = (row: Row) => {
    if (!row.origin) return null;
    const event = events.value.find((candidate) => candidate.id === row.origin?.eventId);
    return event?.type === 'status_set' ? (event.payload.lot?.address ?? null) : null;
  };

  return (
    <section class="card-section" id="lot-section" aria-label={strings.card.lotSection}>
      <h3>{strings.card.lotSection}</h3>
      {others.map((other) => (
        <article key={other.houseKey} class="lot-house">
          <p class="strong">
            {other.address}
            {other.distance !== null && (
              <span class="muted"> · {strings.card.distance(other.distance)}</span>
            )}
          </p>
          <ul class="card-owners">
            {other.rows.map((row) => (
              <li key={row.rowId} class="lot-owner">
                <span>
                  <span class="parcel">{row.parcelIdRaw.trim()}</span> {nameOf(row, roles)}
                </span>
                <StatusChip row={row} />
                {originOf(row) && (
                  <span class="muted">{strings.card.via(originOf(row) ?? '')}</span>
                )}
              </li>
            ))}
          </ul>
          {other.numbers.map((number) => (
            <button
              key={number.digits}
              type="button"
              class="link-button"
              onClick={() => void dial(other.houseKey, number)}
            >
              {strings.card.call}: {numberText(number)}
            </button>
          ))}
          <div class="row-actions">
            <button
              type="button"
              class="button"
              onClick={() => {
                selectHouse(other.houseKey);
              }}
            >
              {strings.card.open}
            </button>
            {other.position && (
              <button
                type="button"
                class="button"
                onClick={() => {
                  const position = other.position;
                  closeCard();
                  if (position) focusOn(position, 15);
                }}
              >
                {strings.card.showOnMap}
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

/** Which rows a note covers, as the card says it: "All 3 rows", or the owners. */
function coverage(note: Note, rows: readonly Row[], roles: Parameters<typeof nameOf>[1]): string {
  const covered = rows.filter((row) => note.rowIds.includes(row.rowId));
  if (covered.length === rows.length && rows.length > 1) return strings.card.allRows(rows.length);
  return [...new Set(covered.map((row) => nameOf(row, roles)))].join(', ');
}

/** A note; pressing and holding a house or row note asks to delete it (§5.6). */
function NoteItem({ note, label }: { note: Note; label: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const format = settings.value?.dateFormat ?? DEFAULT_DATE_FORMAT;
  const deletable = (note.kind === 'house' || note.kind === 'row') && note.eventId !== null;
  const hold = () => {
    if (!deletable) return;
    timer.current = setTimeout(() => {
      if (note.eventId) sheet.value = { kind: 'deleteNote', noteEventId: note.eventId };
    }, 600);
  };
  const release = () => {
    clearTimeout(timer.current);
  };
  return (
    <li
      class={`note note-${note.kind}`}
      tabIndex={deletable ? 0 : undefined}
      onPointerDown={hold}
      onPointerUp={release}
      onPointerLeave={release}
      onContextMenu={(event) => {
        if (deletable) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (deletable && note.eventId && (event.key === 'Delete' || event.key === 'Backspace'))
          sheet.value = { kind: 'deleteNote', noteEventId: note.eventId };
      }}
    >
      <p>{note.text}</p>
      <p class="muted">
        {note.kind === 'lot' && <span class="mark">{strings.card.lotMark}</span>}
        {note.kind === 'imported' && <span class="mark">{strings.card.importedMark}</span>}
        {note.at && note.kind !== 'lot' && <span>{formatTime(note.at, format)} · </span>}
        {label}
      </p>
    </li>
  );
}

/** The house's notes, newest first, each saying which rows it covers (§5.6). */
export function NotesList({ rows }: { rows: readonly Row[] }) {
  const loaded = current.value;
  if (!loaded) return null;
  const format = settings.value?.dateFormat ?? DEFAULT_DATE_FORMAT;
  const byRow = notesByRow(rows, events.value, strings.notes, format);
  const seen = new Map<string, Note>();
  for (const row of rows) {
    for (const note of byRow.get(row.rowId) ?? []) {
      const key = note.eventId ?? `imported:${row.rowId}`;
      if (!seen.has(key)) seen.set(key, note);
    }
  }
  const order = new Map(events.value.map((event, i) => [event.id, i]));
  const notes = [...seen.values()].sort(
    (a, b) =>
      (b.eventId ? (order.get(b.eventId) ?? 0) : -1) -
      (a.eventId ? (order.get(a.eventId) ?? 0) : -1),
  );
  return (
    <section class="card-section" aria-label={strings.card.notes}>
      <h3>{strings.card.notes}</h3>
      {notes.length === 0 ? (
        <p class="muted">{strings.card.noNotes}</p>
      ) : (
        <>
          <ul class="notes">
            {notes.map((note) => (
              <NoteItem
                key={note.eventId ?? note.rowIds.join()}
                note={note}
                label={coverage(note, rows, loaded.campaign.roles)}
              />
            ))}
          </ul>
          <p class="muted">{strings.card.deleteHint}</p>
        </>
      )}
    </section>
  );
}

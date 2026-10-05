import { useEffect } from 'preact/hooks';
import { houseNumbers } from '../domain/calls.ts';
import { textOn } from '../domain/color.ts';
import { currentValue, housesOfRows } from '../domain/identity.ts';
import { houseStatus, lotNeighbors } from '../domain/pins.ts';
import { railStatuses, startStatus } from '../domain/statuses.ts';
import type { Row, Status } from '../domain/types.ts';
import { myFix, startLocating } from '../map/geolocation.ts';
import {
  dial,
  pending,
  pinHouseHere,
  reopenHouse,
  tapHouseStatus,
  tapRowStatus,
} from './actions.ts';
import { FieldsView, LotSection, NotesList } from './CardSections.tsx';
import { current, statuses } from './flow.ts';
import { cardFull, closeCard, expandedRowId, highlightedRowId, sheet } from './mapState.ts';
import { addressOf, nameOf } from './rowText.ts';
import { strings } from './strings.ts';
import { numberText, StatusChip, statusOf, when } from './StatusChip.tsx';
import { Swatch } from './Swatch.tsx';

/**
 * The status rail: one swatch per status, drawn like strips of flagging tape, big enough
 * for a gloved thumb. Skipped is "an option" (Alex, 2026-10-01): a narrower strip at the end.
 */
export function StatusRail({
  label,
  size,
  onTap,
}: {
  label: string;
  size: 'house' | 'row';
  onTap: (status: Status) => void;
}) {
  return (
    <div class={`rail rail-${size}`} role="group" aria-label={label}>
      {railStatuses(statuses.value).map((status) => (
        <button
          key={status.id}
          type="button"
          class={status.id === 'skipped' ? 'tape tape-option' : 'tape'}
          style={{ backgroundColor: status.color, color: textOn(status.color) }}
          onClick={() => {
            onTap(status);
          }}
        >
          {status.label}
        </button>
      ))}
    </div>
  );
}

/** Row detail: one row's numbers and email, its own rail, its note and edit. */
function RowDetail({ row, houseKey }: { row: Row; houseKey: string }) {
  const loaded = current.value;
  if (!loaded) return null;
  const { campaign } = loaded;
  const numbers = houseNumbers([row], campaign.columnOrder, campaign.roles, (r) =>
    nameOf(r, campaign.roles),
  );
  const email = currentValue(row, campaign.roles.email).trim();
  return (
    <div class="row-detail">
      {numbers.map((number) => (
        <button
          key={number.digits}
          type="button"
          class="link-button"
          onClick={() => void dial(houseKey, number)}
        >
          {strings.card.call}: {numberText(number)}
        </button>
      ))}
      {email && (
        <a class="link-button" href={`mailto:${email}`}>
          {email}
        </a>
      )}
      <StatusRail
        label={strings.card.rowRail}
        size="row"
        onTap={(status) => void tapRowStatus(houseKey, row.rowId, status.id)}
      />
      <div class="row-actions">
        <button
          type="button"
          class="button"
          onClick={() => {
            sheet.value = { kind: 'note', houseKey, rowId: row.rowId };
          }}
        >
          {strings.card.noteForRow}
        </button>
        <button
          type="button"
          class="button"
          onClick={() => {
            sheet.value = { kind: 'editRow', houseKey, rowId: row.rowId };
          }}
        >
          {strings.card.editRow}
        </button>
        <button
          type="button"
          class="button"
          onClick={() => void tapRowStatus(houseKey, row.rowId, startStatus(statuses.value).id)}
        >
          {strings.card.markRowToVisit}
        </button>
      </div>
    </div>
  );
}

/** Rows grouped by parcel ID, in file order: each parcel ID once, then its owners. */
function byParcel(rows: readonly Row[]): { parcelId: string; rows: Row[] }[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const id = row.parcelIdRaw.trim();
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups.entries()].map(([parcelId, list]) => ({ parcelId, rows: list }));
}

/** Use my location for this house, with the GPS accuracy on the button. */
export function PinHereButton({ houseKey }: { houseKey: string }) {
  useEffect(() => {
    startLocating();
  }, []);
  const fix = myFix.value;
  return (
    <button
      type="button"
      class="button"
      disabled={!fix}
      onClick={() => {
        if (fix) void pinHouseHere(houseKey, fix.position, fix.accuracyM);
      }}
    >
      {fix ? strings.card.pinHere(String(Math.round(fix.accuracyM))) : strings.card.waitingForGps}
    </button>
  );
}

/** The house card: peek, then the full view; the rail and the actions stay at the bottom. */
export function HouseCard({ houseKey }: { houseKey: string }) {
  const loaded = current.value;
  if (!loaded) return null;
  const { campaign } = loaded;
  const { roles } = campaign;
  const rows = loaded.rows.filter((row) => row.houseKey === houseKey);
  if (rows.length === 0) return null;
  const address = addressOf(rows, roles);
  const keys = new Set(rows.flatMap((row) => row.lotKeys));
  const full = cardFull.value;
  const placed = rows.some((row) => row.position);
  const position = housesOfRows(rows)[0]?.position ?? null;

  // The lot line: this house's parcels at other houses.
  const elsewhere = lotNeighbors(loaded.rows, houseKey).map((otherKey) => {
    const other = loaded.rows.filter(
      (row) => row.houseKey === otherKey && row.lotKeys.some((key) => keys.has(key)),
    );
    const shared = rows.find((row) => row.lotKeys.some((key) => other[0]?.lotKeys.includes(key)));
    return {
      houseKey: otherKey,
      parcelId: shared?.parcelIdRaw.trim() ?? '',
      address: addressOf(
        loaded.rows.filter((row) => row.houseKey === otherKey),
        roles,
      ),
      owners: other
        .map((row) =>
          strings.card.ownerStatus(nameOf(row, roles), statusOf(row, statuses.value).label),
        )
        .join('; '),
    };
  });

  const status = houseStatus(rows, statuses.value);
  const shared = rows.every((row) => row.statusId === rows[0]?.statusId);
  const numbers = houseNumbers(rows, campaign.columnOrder, roles, (row) => nameOf(row, roles));
  const calls = pending.value.filter((call) => call.houseKey === houseKey);

  return (
    <section class={full ? 'card full' : 'card'} aria-label={address}>
      <header class="card-head">
        <Swatch color={status.color} />
        <h2 class="card-address">{address}</h2>
        {rows.length > 1 && <span class="card-count">{strings.card.rows(rows.length)}</span>}
        <button
          type="button"
          class="icon-button"
          aria-label={full ? strings.card.less : strings.card.more}
          aria-expanded={full}
          onClick={() => {
            cardFull.value = !full;
          }}
        >
          {full ? '▾' : '▴'}
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label={strings.card.close}
          onClick={closeCard}
        >
          ✕
        </button>
      </header>
      <div class="card-scroll">
        {!placed && (
          <div class="unplaced">
            <p class="muted">
              {strings.card.noPosition}. {strings.card.pinHelp}
            </p>
            <PinHereButton houseKey={houseKey} />
          </div>
        )}
        <ul class="card-parcels">
          {byParcel(rows).map((group) => (
            <li key={group.parcelId}>
              <span class="parcel">{group.parcelId}</span>
              <ul class="card-owners">
                {group.rows.map((row) => {
                  const open = expandedRowId.value === row.rowId;
                  return (
                    <li
                      key={row.rowId}
                      class={row.rowId === highlightedRowId.value ? 'highlighted' : undefined}
                    >
                      <button
                        type="button"
                        class="owner"
                        aria-expanded={open}
                        onClick={() => {
                          expandedRowId.value = open ? null : row.rowId;
                        }}
                      >
                        <span class="owner-name">{nameOf(row, roles)}</span>
                        <StatusChip row={row} />
                      </button>
                      {open && <RowDetail row={row} houseKey={houseKey} />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {shared && rows[0]?.visitDate && (
          <p class="status-line">
            {strings.card.statusLine(status.label, when(rows[0].visitDate))}
          </p>
        )}
        {calls.map((call) => (
          <button
            key={call.id}
            type="button"
            class="chip pending-chip"
            onClick={() => {
              sheet.value = { kind: 'outcome', houseKey, pendingId: call.id, number: call.number };
            }}
          >
            {strings.card.pendingCall(call.number)}
          </button>
        ))}
        {elsewhere.map((line) => (
          <button
            key={line.houseKey}
            type="button"
            class="lot-line"
            onClick={() => {
              cardFull.value = true;
              setTimeout(() => {
                document.getElementById('lot-section')?.scrollIntoView({ block: 'start' });
              }, 0);
            }}
          >
            {strings.card.alsoAt(line.parcelId, line.address, line.owners)}
          </button>
        ))}
        {full && (
          <>
            <FieldsView rows={rows} />
            <div class="row-actions">
              <button
                type="button"
                class="button"
                onClick={() => {
                  sheet.value = { kind: 'editHouse', houseKey };
                }}
              >
                {strings.card.editInfo}
              </button>
              {placed && <PinHereButton houseKey={houseKey} />}
            </div>
            <LotSection houseKey={houseKey} />
            <NotesList rows={rows} />
            <button type="button" class="button" onClick={() => void reopenHouse(houseKey)}>
              {strings.card.markHouseToVisit}
            </button>
          </>
        )}
      </div>
      <footer class="card-footer">
        <StatusRail
          label={strings.card.rail}
          size="house"
          onTap={(tapped) => void tapHouseStatus(houseKey, tapped.id)}
        />
        <div class="card-actions">
          <button
            type="button"
            class="action"
            disabled={numbers.length === 0}
            onClick={() => {
              const [only] = numbers;
              if (numbers.length === 1 && only) void dial(houseKey, only);
              else sheet.value = { kind: 'numbers', houseKey, mode: 'call' };
            }}
          >
            {strings.card.call}
          </button>
          <button
            type="button"
            class="action"
            onClick={() => {
              sheet.value = { kind: 'numbers', houseKey, mode: 'log' };
            }}
          >
            {strings.card.logCall}
          </button>
          <button
            type="button"
            class="action"
            onClick={() => {
              sheet.value = { kind: 'note', houseKey, rowId: null };
            }}
          >
            {strings.card.note}
          </button>
          {position ? (
            <a
              class="action"
              href={`https://www.google.com/maps/dir/?api=1&destination=${String(position.lat)},${String(position.lng)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {strings.card.navigate}
            </a>
          ) : (
            <button type="button" class="action" disabled>
              {strings.card.navigate}
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

import { computed, signal } from '@preact/signals';
import type { House } from '../domain/identity.ts';
import { lotNeighbors, mapContent, type Pin } from '../domain/pins.ts';
import type { LatLng } from '../domain/types.ts';
import type { Focus } from '../map/MapView.tsx';
import { current, statuses } from './flow.ts';

/** The house whose card is open. */
export const selectedHouseKey = signal<string | null>(null);
/** The row a search result points at, highlighted on the card. */
export const highlightedRowId = signal<string | null>(null);
/** The status filter chip (§5.2): houses holding at least one row with it. */
export const statusFilter = signal<string | null>(null);
/** The houses sharing the tapped spot, when it holds more than one (§5.2 chooser). */
export const chooserHouseKeys = signal<string[] | null>(null);
/** A list of houses over the map: the houses with no position yet, or the houses of a lot. */
export const houseList = signal<{ title: string; houseKeys: string[] } | null>(null);
export const focus = signal<Focus | null>(null);

/** The card's full view (§5.3), and the row expanded in place (one at a time). */
export const cardFull = signal(false);
export const expandedRowId = signal<string | null>(null);

/** A sheet over the card: the note editor, Edit info, the number chooser, a call's outcome… */
export type Sheet =
  | { kind: 'note'; houseKey: string; rowId: string | null }
  | { kind: 'editHouse'; houseKey: string }
  | { kind: 'editRow'; houseKey: string; rowId: string }
  | { kind: 'numbers'; houseKey: string; mode: 'call' | 'log' }
  | { kind: 'outcome'; houseKey: string; pendingId: string | null; number: string | null }
  | { kind: 'deleteNote'; noteEventId: string };

export const sheet = signal<Sheet | null>(null);

/** A full-screen panel over the map: the day log (§5.7) or the exports (§5.8). */
export const panel = signal<'dayLog' | 'export' | null>(null);

export const content = computed(() =>
  mapContent(current.value?.rows ?? [], statuses.value, statusFilter.value),
);

/** Every house's pin, through the spot it shares. */
const pinOfHouse = computed(() => {
  const byHouse = new Map<string, Pin>();
  for (const pin of content.value.pins) for (const key of pin.houseKeys) byHouse.set(key, pin);
  return byHouse;
});

export const selectedPinId = computed(() => {
  const key = selectedHouseKey.value;
  return key === null ? null : (pinOfHouse.value.get(key)?.id ?? null);
});

/** The other houses on the selected house's lots: a small ring and a dashed tether (§5.2). */
export const linked = computed(() => {
  const key = selectedHouseKey.value;
  const rows = current.value?.rows ?? [];
  if (key === null) return { pinIds: new Set<string>(), from: null, to: [] as LatLng[] };
  const pins = lotNeighbors(rows, key)
    .map((neighbor) => pinOfHouse.value.get(neighbor))
    .filter((pin): pin is Pin => pin !== undefined);
  const own = pinOfHouse.value.get(key) ?? null;
  const unique = [...new Map(pins.map((pin) => [pin.id, pin])).values()].filter(
    (pin) => pin.id !== own?.id,
  );
  return {
    pinIds: new Set(unique.map((pin) => pin.id)),
    from: own?.position ?? null,
    to: unique.map((pin) => pin.position),
  };
});

let focusCount = 0;

/** Opens a house's card, and brings its pin into view when it has one. */
export function selectHouse(houseKey: string, rowId: string | null = null): void {
  selectedHouseKey.value = houseKey;
  highlightedRowId.value = rowId;
  chooserHouseKeys.value = null;
  houseList.value = null;
  const pin = pinOfHouse.value.get(houseKey);
  if (pin) focus.value = { id: ++focusCount, position: pin.position, zoom: 15 };
}

export function focusOn(position: LatLng, zoom = 16): void {
  focus.value = { id: ++focusCount, position, zoom };
}

export function closeCard(): void {
  selectedHouseKey.value = null;
  highlightedRowId.value = null;
  cardFull.value = false;
  expandedRowId.value = null;
}

/** A tap on a pin: its card, or the chooser when several houses share the spot. */
export function tapPin(pin: Pin): void {
  const [only] = pin.houseKeys;
  if (pin.houseKeys.length === 1 && only !== undefined) {
    selectedHouseKey.value = only;
    highlightedRowId.value = null;
    chooserHouseKeys.value = null;
  } else {
    chooserHouseKeys.value = pin.houseKeys;
  }
}

export function showUnplaced(title: string, houses: readonly House[]): void {
  houseList.value = { title, houseKeys: houses.map((house) => house.houseKey) };
}

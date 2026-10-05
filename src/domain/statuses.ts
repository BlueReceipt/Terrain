import { fold } from './text.ts';
import type { Status } from './types.ts';

/**
 * Alex's statuses, read from his My Maps pin colors (Phase 1 plan, decision B, 2026-09-30), with his
 * Phase 2 answers (2026-10-01): Given closes the lot and replaces To visit, At door and Skipped
 * elsewhere on it; To research notes the co-owners at other addresses; the rail is Given, At door,
 * To research and Skipped. Not given stays for black pins already on his maps, off the rail.
 */
export const DEFAULT_STATUSES: readonly Status[] = [
  {
    id: 'to-visit',
    label: 'To visit',
    color: '#0288D1',
    packageStatusText: '',
    scope: 'house',
    replaceableByLot: true,
    notesLot: false,
    asksForNote: false,
    isStartStatus: true,
    onRail: false,
    archived: false,
    order: 0,
  },
  {
    id: 'given',
    label: 'Given',
    color: '#0F9D58',
    packageStatusText: 'Given',
    scope: 'lot',
    replaceableByLot: false,
    notesLot: false,
    asksForNote: false,
    isStartStatus: false,
    onRail: true,
    archived: false,
    order: 1,
  },
  {
    id: 'at-door',
    label: 'At door',
    color: '#FFEA00',
    packageStatusText: 'At door',
    scope: 'house',
    replaceableByLot: true,
    notesLot: false,
    asksForNote: false,
    isStartStatus: false,
    onRail: true,
    archived: false,
    order: 2,
  },
  {
    id: 'to-research',
    label: 'To research',
    color: '#FF5252',
    packageStatusText: 'To research',
    scope: 'house',
    replaceableByLot: false,
    notesLot: true,
    asksForNote: true,
    isStartStatus: false,
    onRail: true,
    archived: false,
    order: 3,
  },
  {
    id: 'skipped',
    label: 'Skipped',
    color: '#9C27B0',
    packageStatusText: 'Skipped',
    scope: 'house',
    replaceableByLot: true,
    notesLot: false,
    asksForNote: false,
    isStartStatus: false,
    onRail: true,
    archived: false,
    order: 4,
  },
  {
    id: 'not-given',
    label: 'Not given',
    color: '#000000',
    packageStatusText: 'Not given',
    scope: 'house',
    replaceableByLot: false,
    notesLot: false,
    asksForNote: true,
    isStartStatus: false,
    onRail: false,
    archived: false,
    order: 5,
  },
];

export function startStatus(statuses: readonly Status[]): Status {
  const start = statuses.find((status) => status.isStartStatus) ?? statuses[0];
  if (!start) throw new Error('Terrain needs at least one status.');
  return start;
}

/** The statuses on the rail, in rail order. */
export function railStatuses(statuses: readonly Status[]): Status[] {
  return statuses
    .filter((status) => status.onRail && !status.archived)
    .sort((a, b) => a.order - b.order);
}

/** For files without pin colors: "Given to wife" means Given, "at door." means At door. */
export function statusForPackageText(text: string, statuses: readonly Status[]): Status | null {
  const folded = fold(text);
  if (!folded) return null;
  for (const status of statuses) {
    const expected = fold(status.packageStatusText);
    if (expected && (folded === expected || folded.startsWith(`${expected} `))) return status;
  }
  return null;
}

/** What a status does to the same lots' rows at other houses (§5.10), as Settings offers it. */
export type LotBehavior = 'house' | 'closes' | 'notes';

export function lotBehaviorOf(status: Pick<Status, 'scope' | 'notesLot'>): LotBehavior {
  if (status.scope === 'lot') return 'closes';
  return status.notesLot ? 'notes' : 'house';
}

export function lotFields(behavior: LotBehavior): Pick<Status, 'scope' | 'notesLot'> {
  return { scope: behavior === 'closes' ? 'lot' : 'house', notesLot: behavior === 'notes' };
}

/** '#RRGGBB', the form pin colors are matched in (Alex enters his My Maps hexes, §5.9). */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export type StatusChange = Partial<
  Pick<
    Status,
    | 'label'
    | 'color'
    | 'packageStatusText'
    | 'scope'
    | 'notesLot'
    | 'replaceableByLot'
    | 'asksForNote'
    | 'onRail'
    | 'archived'
  >
>;

/**
 * A status edited in Settings (§5.9). The start status (To visit) keeps its part: only its label
 * and color change, it is never archived and never on the rail.
 */
export function editStatus(
  statuses: readonly Status[],
  id: string,
  change: StatusChange,
): Status[] {
  return statuses.map((status) => {
    if (status.id !== id) return status;
    const color = (change.color ?? status.color).trim().toUpperCase();
    if (status.isStartStatus) return { ...status, label: change.label ?? status.label, color };
    return { ...status, ...change, color };
  });
}

/** A new status, last on the rail, touching only its own house until Alex says otherwise. */
export function addStatus(
  statuses: readonly Status[],
  id: string,
  label: string,
  color: string,
): Status[] {
  const order = Math.max(0, ...statuses.map((status) => status.order)) + 1;
  return [
    ...statuses,
    {
      id,
      label,
      color: color.toUpperCase(),
      packageStatusText: label,
      scope: 'house',
      replaceableByLot: true,
      notesLot: false,
      asksForNote: false,
      isStartStatus: false,
      onRail: true,
      archived: false,
      order,
    },
  ];
}

/** A status one place earlier or later on the rail. */
export function moveStatus(statuses: readonly Status[], id: string, by: -1 | 1): Status[] {
  const sorted = [...statuses].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((status) => status.id === id);
  const to = from + by;
  const moving = sorted[from];
  const other = sorted[to];
  if (from < 0 || !moving || !other) return [...statuses];
  sorted[from] = other;
  sorted[to] = moving;
  return sorted.map((status, order) => ({ ...status, order }));
}

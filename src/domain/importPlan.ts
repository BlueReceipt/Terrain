import { suggestStatus } from './color.ts';
import { APP_ROLES, defaultColumnGroups } from './columns.ts';
import { mergeImport, type MergeResult } from './merge.ts';
import { splitParcelIds } from './parcel.ts';
import { buildReport, type ImportReport } from './report.ts';
import { applyIdentity } from './rows.ts';
import { startStatus } from './statuses.ts';
import { compactKey } from './text.ts';
import type { Campaign, ColumnGroup, ColumnRoles, ParsedFile, Row, Status } from './types.ts';

/** An import that has been worked out but not saved: what the report screen shows. */
export interface ImportPlan {
  parsed: ParsedFile;
  campaign: Campaign;
  isNewCampaign: boolean;
  merge: MergeResult;
  report: ImportReport;
  existingParcelKeys: ReadonlySet<string>;
}

export interface PlanInput {
  parsed: ParsedFile;
  /** The campaign to merge into; null starts a new one. */
  campaign: Campaign | null;
  existingRows: readonly Row[];
  statuses: readonly Status[];
  roles: ColumnRoles;
  colorMap: Record<string, string>;
  lotColumn: string | null;
  now: string;
  newId: () => string;
  /** Per existing row, the notes Terrain may have written into an export (`ownNoteTexts`). */
  ownNotes?: ReadonlyMap<string, readonly string[]>;
}

/** Each pin color of the file, mapped to a status: the campaign's earlier choice, else a suggestion. */
export function initialColorMap(
  parsed: ParsedFile,
  statuses: readonly Status[],
  previous: Readonly<Record<string, string>> = {},
): { colorMap: Record<string, string>; unmatched: string[] } {
  const colorMap: Record<string, string> = {};
  const unmatched: string[] = [];
  for (const row of parsed.rows) {
    const color = row.pinColor;
    if (color === null || color in colorMap) continue;
    const earlier = previous[color];
    const suggested = suggestStatus(color, statuses);
    if (earlier !== undefined) colorMap[color] = earlier;
    else if (suggested) colorMap[color] = suggested.id;
    else {
      colorMap[color] = startStatus(statuses).id;
      unmatched.push(color);
    }
  }
  return { colorMap, unmatched };
}

/** After the column mapping screen picks the parcel ID column of a spreadsheet. */
export function withParcelIdColumn(parsed: ParsedFile, column: string): ParsedFile {
  if (parsed.format !== 'tabular') return parsed;
  return {
    ...parsed,
    roles: { ...parsed.roles, parcelId: column },
    rows: parsed.rows.map((row) => ({ ...row, parcelIdRaw: (row.fields[column] ?? '').trim() })),
  };
}

/** App-owned roles the file doesn't have: the column mapping screen asks about them (§5.1). */
export function missingRoles(parsed: ParsedFile, roles: ColumnRoles): (keyof ColumnRoles)[] {
  const missing: (keyof ColumnRoles)[] = [];
  if (parsed.format === 'tabular' && !roles.parcelId) missing.push('parcelId');
  for (const role of APP_ROLES) if (!roles[role]) missing.push(role);
  return missing;
}

function appendNew(existing: readonly string[], incoming: readonly string[]): string[] {
  const all = [...existing];
  for (const item of incoming) if (!all.includes(item)) all.push(item);
  return all;
}

/** [west, south, east, north] of the rows with a position. */
export function boundsOf(rows: readonly Row[]): Campaign['bounds'] {
  const placed = rows.filter((row) => row.position);
  if (placed.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { position } of placed) {
    if (!position) continue;
    west = Math.min(west, position.lng);
    east = Math.max(east, position.lng);
    south = Math.min(south, position.lat);
    north = Math.max(north, position.lat);
  }
  return [west, south, east, north];
}

function reportFor(plan: Omit<ImportPlan, 'report'>): ImportReport {
  return buildReport({
    fileName: plan.parsed.fileName,
    incoming: plan.parsed.rows,
    referenceFeatures: plan.parsed.reference.length,
    layers: plan.parsed.layers,
    roles: plan.campaign.roles,
    colorMap: plan.campaign.colorMap,
    merge: plan.merge,
    existingParcelKeys: plan.existingParcelKeys,
  });
}

export function planImport(input: PlanInput): ImportPlan {
  const { parsed, roles } = input;
  const isNewCampaign = input.campaign === null;
  const base: Campaign = input.campaign ?? {
    id: input.newId(),
    name: parsed.fileName.replace(/\.[^.]+$/, ''),
    createdAt: input.now,
    sourceFiles: [],
    columnOrder: [],
    columnGroups: {},
    roles,
    lotColumn: null,
    colorMap: {},
    layers: [],
    bounds: null,
    reference: [],
  };

  const appColumns = new Set(APP_ROLES.map((role) => roles[role]));
  const columnGroups: Record<string, ColumnGroup> = isNewCampaign
    ? defaultColumnGroups(parsed.columns, roles)
    : { ...base.columnGroups };
  for (const column of parsed.columns) {
    if (!(column in columnGroups) && !appColumns.has(column)) columnGroups[column] = 'person';
  }

  const campaign: Campaign = {
    ...base,
    sourceFiles: [...base.sourceFiles, parsed.fileName],
    columnOrder: appendNew(base.columnOrder, parsed.columns),
    columnGroups,
    roles,
    lotColumn: input.lotColumn,
    colorMap: { ...base.colorMap, ...input.colorMap },
    layers: appendNew(base.layers, parsed.layers),
    reference: parsed.reference.length > 0 ? parsed.reference : base.reference,
  };
  const merge = mergeImport({
    campaign,
    existing: input.existingRows,
    incoming: parsed.rows,
    statuses: input.statuses,
    now: input.now,
    newId: input.newId,
    ownNotes: input.ownNotes,
  });
  campaign.bounds = boundsOf(merge.rows);
  const existingParcelKeys = new Set(
    input.existingRows.flatMap((row) => splitParcelIds(row.parcelIdRaw).map(compactKey)),
  );
  const plan = { parsed, campaign, isNewCampaign, merge, existingParcelKeys };
  return { ...plan, report: reportFor(plan) };
}

function regroup(plan: ImportPlan, campaign: Campaign, rows: readonly Row[]): ImportPlan {
  const identity = applyIdentity(rows, campaign);
  const merge: MergeResult = { ...plan.merge, rows: identity.rows, houses: identity.houses };
  const next = { ...plan, campaign, merge };
  return { ...next, report: reportFor(next) };
}

/** "Group rows into lots by" changed on the report (§5.1): lots and their counts recompute on the spot. */
export function withLotColumn(plan: ImportPlan, lotColumn: string | null): ImportPlan {
  return regroup(plan, { ...plan.campaign, lotColumn }, plan.merge.rows);
}

/** Alex marked IDs of a several-ID cell as old (crossed out in the client's file). */
export function withOldParcelIds(
  plan: ImportPlan,
  rowId: string,
  oldIds: readonly string[],
): ImportPlan {
  const rows = plan.merge.rows.map((row) =>
    row.rowId === rowId ? { ...row, oldParcelIds: [...oldIds] } : row,
  );
  return regroup(plan, plan.campaign, rows);
}

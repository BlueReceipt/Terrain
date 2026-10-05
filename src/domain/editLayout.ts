import { myMapsColumnOf } from './columns.ts';
import { currentReader, currentValue, displayName } from './identity.ts';
import { splitParcelIds } from './parcel.ts';
import { compactKey, fold } from './text.ts';
import type { Campaign, ColumnGroup, ColumnRoles, Row } from './types.ts';

/** One field of Edit info. */
export interface LayoutField {
  column: string;
  value: string;
  /** The rows an edit of this field writes. */
  rowIds: string[];
  /** Shown for one row because the rows it would cover disagree ("differs"). */
  differs: boolean;
  /** A covered row holds a correction in this column (the edited mark). */
  edited: boolean;
}

export interface EditLayout {
  /** House fields: once for the house, or once per row where its rows disagree. None by default. */
  house: LayoutField[];
  /** Parcel fields, once per parcel ID cell at the house, in file order. */
  parcels: { parcelId: string; rowIds: string[]; fields: LayoutField[] }[];
  /** Person fields, once per owner at the house, in file order: an owner's rows edit together. */
  people: { name: string; rowIds: string[]; fields: LayoutField[] }[];
}

type CampaignColumns = Pick<Campaign, 'columnOrder' | 'columnGroups' | 'roles'>;

/**
 * Columns Edit info shows, in file order: not the app-owned columns, the parcel ID, coordinates, or
 * the columns Terrain writes for My Maps.
 */
export function editableColumns(
  campaign: CampaignColumns,
): { column: string; group: ColumnGroup }[] {
  const { roles } = campaign;
  const fixed = new Set([roles.parcelId, roles.lat, roles.lng, roles.wkt]);
  const columns: { column: string; group: ColumnGroup }[] = [];
  for (const column of campaign.columnOrder) {
    const group = campaign.columnGroups[column];
    if (group && !fixed.has(column) && myMapsColumnOf(column, roles) === null)
      columns.push({ column, group });
  }
  return columns;
}

/** One field for rows that agree, or one per row, marked "differs", so nothing is silently merged. */
function sharedFields(rows: readonly Row[], column: string): LayoutField[] {
  const values = rows.map((row) => currentValue(row, column));
  if (values.every((value) => value === values[0])) {
    return [
      {
        column,
        value: values[0] ?? '',
        rowIds: rows.map((row) => row.rowId),
        differs: false,
        edited: rows.some((row) => column in row.edits),
      },
    ];
  }
  return rows.map((row, i) => ({
    column,
    value: values[i] ?? '',
    rowIds: [row.rowId],
    differs: true,
    edited: column in row.edits,
  }));
}

/**
 * Rows sharing a parcel ID cell. A cell listing several IDs ("PT7-012/011/010") is one group, so an
 * edit never spills onto rows of another parcel; IDs marked old don't count, and a blank cell is alone.
 */
function parcelKey(row: Row): string {
  const old = new Set(row.oldParcelIds.map(compactKey));
  const ids = [
    ...new Set(
      splitParcelIds(row.parcelIdRaw)
        .map(compactKey)
        .filter((id) => !old.has(id)),
    ),
  ].filter(Boolean);
  return ids.length > 0 ? ids.sort().join('|') : `row:${row.rowId}`;
}

/**
 * The rows of one owner at a house: the same first and last name, or else the same company. A fix
 * goes on that owner only (Alex, 2026-10-01: changing one co-owner's number must not change the
 * other's on the same parcel), on each of the owner's rows. A row naming no one (APPEL alone, or
 * nothing) is an owner of its own.
 */
function ownerKey(row: Row, roles: ColumnRoles): string {
  const read = currentReader(row, roles);
  const person = fold(`${read('firstName')} ${read('lastName')}`);
  return person || fold(read('company')) || `row:${row.rowId}`;
}

function groupBy(rows: readonly Row[], keyOf: (row: Row) => string): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
}

/** Which fields Edit info shows once and which per row, and which rows each field writes. */
export function editLayout(houseRows: readonly Row[], campaign: CampaignColumns): EditLayout {
  const rows = [...houseRows].sort((a, b) => a.rowIndex - b.rowIndex);
  const columns = editableColumns(campaign);
  const of = (group: ColumnGroup) =>
    columns.filter((entry) => entry.group === group).map((entry) => entry.column);

  return {
    house: of('house').flatMap((column) => sharedFields(rows, column)),
    parcels: groupBy(rows, parcelKey).map((group) => ({
      parcelId: group[0]?.parcelIdRaw.trim() ?? '',
      rowIds: group.map((row) => row.rowId),
      fields: of('parcel').flatMap((column) => sharedFields(group, column)),
    })),
    people: groupBy(rows, (row) => ownerKey(row, campaign.roles)).map((group) => ({
      name: group[0] ? displayName(currentReader(group[0], campaign.roles)) : '',
      rowIds: group.map((row) => row.rowId),
      fields: of('person').flatMap((column) => sharedFields(group, column)),
    })),
  };
}

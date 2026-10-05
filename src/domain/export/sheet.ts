import { APP_ROLES, MY_MAPS_COLUMNS, myMapsColumnOf } from '../columns.ts';
import type { TerrainEvent } from '../events.ts';
import { formatCell, type DateFormat } from '../format.ts';
import { currentValue, myMapsValue } from '../identity.ts';
import { notesByRow, notesCell, type NotesExportMode, type NoteWords } from '../notes.ts';
import type { AppRole, Campaign, Row } from '../types.ts';

export interface ExportInput {
  campaign: Pick<Campaign, 'name' | 'columnOrder' | 'roles' | 'layers'>;
  rows: readonly Row[];
  events: readonly TerrainEvent[];
  words: NoteWords;
  /** Headers of Terrain's columns the client's file doesn't have; they go at the end. */
  appHeaders: Readonly<Record<AppRole, string>>;
  format: DateFormat;
  notesMode: NotesExportMode;
}

export interface ExportColumn {
  header: string;
  cell: (row: Row) => string;
}

/**
 * The columns of an export (§5.8), in the client's order: the parcel ID first when it is the pin's
 * title (KMZ), then every original column with current values, corrections included. Terrain fills
 * its own columns: Package status, Visit date and Call date as text in the date format, call result,
 * and Notes per the notes setting. Those the file doesn't have are added at the end, so no work is
 * lost. Columns Terrain wrote for My Maps that came back from it carry current values.
 */
export function exportColumns(input: ExportInput): ExportColumn[] {
  const { campaign, rows, events, words, format, notesMode } = input;
  const { roles } = campaign;
  const notes = notesByRow(rows, events, words, format);
  const appCell: Record<AppRole, (row: Row) => string> = {
    packageStatus: (row) => row.packageStatusText,
    visitDate: (row) => formatCell(row.visitDate, format),
    callDate: (row) => formatCell(row.callDate, format),
    callResult: (row) => row.callResult,
    notes: (row) => notesCell(notes.get(row.rowId) ?? [], notesMode, words, format),
  };
  const coordinate = (axis: 'lat' | 'lng', column: string) => (row: Row) =>
    row.position ? String(row.position[axis]) : currentValue(row, column);

  const columns: ExportColumn[] = [];
  // In a KMZ the parcel ID is each pin's title: it leads, as in the client's sheet.
  const fromPins = roles.parcelId === undefined;
  if (
    fromPins &&
    !campaign.columnOrder.some((column) => myMapsColumnOf(column, roles) === 'parcelId')
  )
    columns.push({ header: MY_MAPS_COLUMNS.parcelId, cell: (row) => row.parcelIdRaw });
  for (const column of campaign.columnOrder) {
    const role = APP_ROLES.find((candidate) => roles[candidate] === column);
    const mine = myMapsColumnOf(column, roles);
    let cell: (row: Row) => string;
    if (role) cell = appCell[role];
    else if (mine) cell = (row) => myMapsValue(row, mine, roles);
    else if (column === roles.parcelId) cell = (row) => row.parcelIdRaw;
    else if (column === roles.lat) cell = coordinate('lat', column);
    else if (column === roles.lng) cell = coordinate('lng', column);
    else cell = (row) => currentValue(row, column);
    columns.push({ header: column, cell });
  }
  for (const role of APP_ROLES) {
    if (roles[role] === undefined)
      columns.push({ header: input.appHeaders[role], cell: appCell[role] });
  }
  return columns;
}

/** Rows in the client's order (§6.4: rows missing from the last file come after the others). */
export function inFileOrder(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => a.rowIndex - b.rowIndex);
}

/**
 * The Parcels sheet (§5.8): the header, then one line per row in the original order. Rows at one
 * house carry the same status, Visit date and house notes, each on its own line.
 */
export function parcelsSheet(input: ExportInput): string[][] {
  const columns = exportColumns(input);
  return [
    columns.map((column) => column.header),
    ...inFileOrder(input.rows).map((row) => columns.map((column) => column.cell(row))),
  ];
}

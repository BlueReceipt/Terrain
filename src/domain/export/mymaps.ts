import { headerKey, MY_MAPS_COLUMNS } from '../columns.ts';
import { myMapsValue } from '../identity.ts';
import type { ColumnRoles, Row } from '../types.ts';
import { exportColumns, inFileOrder, type ExportColumn, type ExportInput } from './sheet.ts';

/** UTF-8 byte-order mark: Excel and My Maps then read accents right. */
const BOM = String.fromCharCode(0xfeff);

/** My Maps imports up to 2,000 rows per file (its help page): a bigger layer needs splitting there. */
export const MY_MAPS_ROW_LIMIT = 2000;

/** One field of a CSV line, quoted when it holds a comma, a quote, a line break or edge spaces. */
function csvField(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The rows of one My Maps layer (a KML folder), in file order. */
export function layerRows(rows: readonly Row[], layer: string): Row[] {
  return inFileOrder(rows.filter((row) => row.layer === layer));
}

/**
 * The My Maps update for one layer (§5.8, §3): Parcel ID (the pin's title), every original column
 * in order with current values, then Latitude, Longitude and Location, for Reimport and merge →
 * Replace all items. UTF-8 with a byte-order mark so accents survive, lines ending in CRLF.
 */
export function myMapsCsv(input: ExportInput, layer: string): string {
  const { roles } = input.campaign;
  const named = (header: string) => (column: ExportColumn) =>
    headerKey(column.header) === headerKey(header);
  const columns = exportColumns(input);
  const parcel = columns.find(named(MY_MAPS_COLUMNS.parcelId));
  const all: ExportColumn[] = [
    parcel ?? { header: MY_MAPS_COLUMNS.parcelId, cell: (row) => row.parcelIdRaw },
    ...columns.filter((column) => column !== parcel),
  ];
  // Coordinates and Location, unless the file already has them (a layer that went through My Maps,
  // or a spreadsheet with its own coordinate columns).
  if (!roles.lat && !all.some(named(MY_MAPS_COLUMNS.latitude)))
    all.push({
      header: MY_MAPS_COLUMNS.latitude,
      cell: (row) => myMapsValue(row, 'latitude', roles),
    });
  if (!roles.lng && !all.some(named(MY_MAPS_COLUMNS.longitude)))
    all.push({
      header: MY_MAPS_COLUMNS.longitude,
      cell: (row) => myMapsValue(row, 'longitude', roles),
    });
  if (!all.some(named(MY_MAPS_COLUMNS.location)))
    all.push({
      header: MY_MAPS_COLUMNS.location,
      cell: (row) => myMapsValue(row, 'location', roles),
    });

  const lines = [
    all.map((column) => csvField(column.header)),
    ...layerRows(input.rows, layer).map((row) => all.map((column) => csvField(column.cell(row)))),
  ];
  return `${BOM}${lines.map((line) => line.join(',')).join('\r\n')}\r\n`;
}

/** Rows My Maps can't place: no position and no address. Pinning the house in Terrain fixes it. */
export function unplaceable(rows: readonly Row[], layer: string, roles: ColumnRoles): Row[] {
  return layerRows(rows, layer).filter((row) => myMapsValue(row, 'location', roles) === '');
}

/** How a layer's pins can be placed in My Maps: by Latitude and Longitude when every row has them. */
export function positionedBy(rows: readonly Row[], layer: string): 'coordinates' | 'location' {
  return layerRows(rows, layer).every((row) => row.position) ? 'coordinates' : 'location';
}

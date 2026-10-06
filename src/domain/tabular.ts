import * as XLSX from 'xlsx';
import { detectRoles } from './columns.ts';
import { ImportError } from './errors.ts';
import type { ColumnRoles, IncomingRow, LatLng, ParsedFile } from './types.ts';

/** Excel's CSV export on French Windows is Windows-1252, not UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function positionOf(
  raw: readonly unknown[],
  index: Readonly<Record<string, number>>,
  roles: ColumnRoles,
): LatLng | null {
  const cell = (column: string | undefined): unknown =>
    column === undefined ? undefined : raw[index[column] ?? -1];
  const lat = toNumber(cell(roles.lat));
  const lng = toNumber(cell(roles.lng));
  if (
    lat !== null &&
    lng !== null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    (lat !== 0 || lng !== 0)
  ) {
    return { lat, lng };
  }
  const wkt = cell(roles.wkt);
  const match =
    typeof wkt === 'string' ? /POINT\s*Z?\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)/i.exec(wkt) : null;
  if (match) {
    const pointLng = Number(match[1]);
    const pointLat = Number(match[2]);
    if (Number.isFinite(pointLat) && Number.isFinite(pointLng))
      return { lat: pointLat, lng: pointLng };
  }
  return null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** XLSX or CSV exported with coordinates (from My Maps, a Sheet, or a Terrain export). */
export function parseTabular(bytes: Uint8Array, fileName: string): ParsedFile {
  const isCsv = /\.csv$/i.test(fileName);
  let workbook: XLSX.WorkBook;
  try {
    workbook = isCsv
      ? XLSX.read(decodeText(bytes), { type: 'string', raw: true })
      : XLSX.read(bytes, { type: 'array' });
  } catch {
    throw new ImportError('unreadable-spreadsheet');
  }

  const columns: string[] = [];
  const layers: string[] = [];
  const rows: IncomingRow[] = [];
  const sheets: { name: string; header: string[]; text: unknown[][]; raw: unknown[][] }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const text = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    });
    const headerAt = text.findIndex(
      (cells) => cells.filter((cell) => cellText(cell).trim() !== '').length >= 2,
    );
    if (headerAt === -1) continue;
    const header = (text[headerAt] ?? []).map(
      (cell, i) => cellText(cell).trim() || `Column ${String(i + 1)}`,
    );
    for (const column of header) if (!columns.includes(column)) columns.push(column);
    sheets.push({
      name: isCsv ? fileName.replace(/\.[^.]+$/, '') : sheetName,
      header,
      text: text.slice(headerAt + 1),
      raw: raw.slice(headerAt + 1),
    });
  }

  const roles = detectRoles(columns);
  // Without coordinates, a street and a town let Terrain find each house from its address.
  const findable = Boolean(roles.street && roles.town);
  if (!(roles.lat && roles.lng) && !roles.wkt && !findable) throw new ImportError('no-coordinates');

  for (const sheet of sheets) {
    const index: Record<string, number> = {};
    sheet.header.forEach((column, i) => (index[column] ??= i));
    sheet.text.forEach((cells, r) => {
      if (cells.every((cell) => cellText(cell).trim() === '')) return;
      const fields: Record<string, string> = {};
      sheet.header.forEach((column, i) => {
        fields[column] = cellText(cells[i]);
      });
      if (!layers.includes(sheet.name)) layers.push(sheet.name);
      rows.push({
        sourceIndex: rows.length,
        layer: sheet.name,
        parcelIdRaw: roles.parcelId ? (fields[roles.parcelId] ?? '').trim() : '',
        fields,
        position: positionOf(sheet.raw[r] ?? [], index, roles),
        addressText: null,
        pinColor: null,
      });
    });
  }

  if (rows.length === 0) throw new ImportError('no-rows');
  if (!findable && !rows.some((row) => row.position)) throw new ImportError('no-coordinates');
  return { fileName, format: 'tabular', columns, layers, rows, reference: [], roles };
}

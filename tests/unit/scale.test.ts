import { describe, expect, it } from 'vitest';
import { detectRoles } from '../../src/domain/columns.ts';
import type { IncomingRow, ParsedFile } from '../../src/domain/types.ts';
import { buildBigLayers, COLUMNS } from '../../scripts/make-fixtures.ts';
import { importInto } from '../support/import.ts';

/** A campaign of any size, as the KML reader would hand it over (the browser parses KML natively). */
function campaignOf(count: number): ParsedFile {
  const layers = buildBigLayers(count);
  const rows: IncomingRow[] = Object.entries(layers).flatMap(([layer, caseRows]) =>
    caseRows.map((row) => ({
      sourceIndex: 0,
      layer,
      parcelIdRaw: row.name,
      fields: Object.fromEntries(COLUMNS.map((column) => [column, row.fields[column] ?? ''])),
      position: row.point ? { lat: row.point[1], lng: row.point[0] } : null,
      addressText: row.point
        ? null
        : `${row.fields.ADRESSE ?? ''} ${row.fields.MUNICIPALITE ?? ''}`,
      pinColor: row.color,
    })),
  );
  rows.forEach((row, i) => (row.sourceIndex = i));
  return {
    fileName: `${String(count)}.kmz`,
    format: 'kml',
    columns: [...COLUMNS],
    layers: Object.keys(layers),
    rows,
    reference: [],
    roles: detectRoles(COLUMNS),
  };
}

// Terrain has no limit on rows or houses: a campaign holds whatever the client's file holds.
describe('campaign size', () => {
  it.each([100, 10_000])(
    'imports %i rows, every row kept and grouped',
    (count) => {
      const parsed = campaignOf(count);
      const plan = importInto(parsed);
      expect(plan.merge.rows).toHaveLength(count);
      expect(plan.merge.rows.every((row) => row.houseKey !== '')).toBe(true);
      const doors = new Set(parsed.rows.map((row) => row.fields.ADRESSE));
      expect(plan.report.houseCount).toBe(doors.size);
      expect(plan.report.housesWithoutPosition.length).toBeGreaterThan(0);
    },
    60_000,
  );
});

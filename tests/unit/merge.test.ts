import { describe, expect, it } from 'vitest';
import type { ImportPlan } from '../../src/domain/importPlan.ts';
import { POSITION_COLUMN, STATUS_COLUMN } from '../../src/domain/merge.ts';
import type { IncomingRow, ParsedFile, Row } from '../../src/domain/types.ts';
import { importInto, parseFixture, rowByParcel } from '../support/import.ts';

const first = importInto(parseFixture('public/cases.kmz'));

/** Alex's local work on the committed campaign: a correction, a moved house, a tapped status. */
function withLocalWork(plan: ImportPlan, change: (row: Row) => Row): Row[] {
  return plan.merge.rows.map(change);
}

function fileWith(
  change: (row: IncomingRow) => IncomingRow | null,
  extra: IncomingRow[] = [],
): ParsedFile {
  const parsed = parseFixture('public/cases.kmz');
  const rows = parsed.rows.map(change).filter((row): row is IncomingRow => row !== null);
  return { ...parsed, rows: [...rows, ...extra].map((row, i) => ({ ...row, sourceIndex: i })) };
}

describe('re-import', () => {
  it('changes nothing when the same file comes back', () => {
    const again = importInto(parseFixture('public/cases.kmz'), first);
    expect(again.report).toMatchObject({
      added: 0,
      updated: 0,
      unchanged: 28,
      missing: [],
      conflicts: [],
    });
    expect(again.merge.changes).toEqual([]);
    expect(again.merge.rows).toEqual(first.merge.rows);
  });

  it('keeps the history of a single-owner parcel whose owner was renamed', () => {
    const renamed = importInto(parseFixture('public/cases-renamed.kmz'), first);
    const before = rowByParcel(first, 'P1-240');
    const after = rowByParcel(renamed, 'P1-240');
    expect(after.rowId).toBe(before.rowId);
    expect(renamed.report.ownerDetailsChanged.map((row) => row.rowId)).toEqual([before.rowId]);
    expect(renamed.report).toMatchObject({ added: 0, updated: 1 });
    expect(renamed.merge.changes).toEqual([
      { rowId: before.rowId, column: 'NOM', previous: 'Trempoté', next: 'Trempette' },
      { rowId: before.rowId, column: 'CELLULAIRE', previous: '', next: '450 555-0150' },
    ]);
  });

  it('keeps a correction the file disagrees with, and lists the conflict', () => {
    const jean = rowByParcel(first, 'P1-240');
    const rows = withLocalWork(first, (row) =>
      row.rowId === jean.rowId ? { ...row, edits: { TEL_RES: '450 555-0999' } } : row,
    );
    const again = importInto(parseFixture('public/cases.kmz'), first, rows);
    expect(rowByParcel(again, 'P1-240').edits).toEqual({ TEL_RES: '450 555-0999' });
    expect(
      again.report.conflicts.map(({ column, local, incoming }) => ({ column, local, incoming })),
    ).toEqual([{ column: 'TEL_RES', local: '450 555-0999', incoming: '' }]);
    expect(again.report.updated).toBe(0);
  });

  it('absorbs a correction the client adopted, keeping the previous value on record', () => {
    const jean = rowByParcel(first, 'P1-240');
    const rows = withLocalWork(first, (row) =>
      row.rowId === jean.rowId ? { ...row, edits: { TEL_RES: '450 555-0999' } } : row,
    );
    const adopted = fileWith((row) =>
      row.parcelIdRaw === 'P1-240'
        ? { ...row, fields: { ...row.fields, TEL_RES: '450 555-0999' } }
        : row,
    );
    const again = importInto(adopted, first, rows);
    expect(rowByParcel(again, 'P1-240').edits).toEqual({});
    expect(rowByParcel(again, 'P1-240').sourceFields.TEL_RES).toBe('450 555-0999');
    expect(again.merge.absorbed).toEqual([{ rowId: jean.rowId, column: 'TEL_RES' }]);
    expect(again.merge.changes).toContainEqual({
      rowId: jean.rowId,
      column: 'TEL_RES',
      previous: '',
      next: '450 555-0999',
    });
  });

  it('keeps a moved house where Alex put it', () => {
    const luc = rowByParcel(first, 'P1-216B', 'Trempette');
    const moved = { lat: 45.3, lng: -73.6 };
    const rows = withLocalWork(first, (row) =>
      row.rowId === luc.rowId
        ? { ...row, position: moved, touched: { ...row.touched, moved: true } }
        : row,
    );
    const again = importInto(parseFixture('public/cases.kmz'), first, rows);
    expect(again.merge.rows.find((row) => row.rowId === luc.rowId)?.position).toEqual(moved);
    expect(again.report.conflicts.map((conflict) => conflict.column)).toEqual([POSITION_COLUMN]);
  });

  it('keeps a status Alex tapped, and app fields he touched', () => {
    const paul = rowByParcel(first, 'P1-222');
    const rows = withLocalWork(first, (row) =>
      row.rowId === paul.rowId
        ? {
            ...row,
            statusId: 'given',
            packageStatusText: 'Given',
            visitDate: '2026-09-26 14:32',
            touched: { appFields: ['status', 'packageStatus', 'visitDate'], moved: false },
          }
        : row,
    );
    const again = importInto(parseFixture('public/cases.kmz'), first, rows);
    expect(rowByParcel(again, 'P1-222')).toMatchObject({
      statusId: 'given',
      packageStatusText: 'Given',
      visitDate: '2026-09-26 14:32',
    });
    expect(again.report.conflicts.map((conflict) => conflict.column).sort()).toEqual(
      ['Package status', STATUS_COLUMN, 'Visit date'].sort(),
    );
  });

  it('takes new app values from the file where Alex did nothing', () => {
    const file = fileWith((row) =>
      row.parcelIdRaw === 'P1-233'
        ? { ...row, pinColor: '#7CB342', fields: { ...row.fields, 'Package status': 'Given' } }
        : row,
    );
    const again = importInto(file, first);
    expect(rowByParcel(again, 'P1-233')).toMatchObject({
      statusId: 'given',
      packageStatusText: 'Given',
    });
  });

  it('adds new rows, keeps and flags rows missing from the file after the others', () => {
    const added: IncomingRow = {
      sourceIndex: 0,
      layer: 'Cases layer',
      parcelIdRaw: 'P1-250',
      fields: { NOM: 'Nouveau', ADRESSE: '1, rue Neuve', 'Nouvelle colonne': 'x' },
      position: { lat: 45.1, lng: -73.1 },
      addressText: null,
      pinColor: '#0288D1',
    };
    const file = fileWith((row) => (row.parcelIdRaw === 'P1-241' ? null : row), [added]);
    const again = importInto({ ...file, columns: [...file.columns, 'Nouvelle colonne'] }, first);
    const luce = rowByParcel(first, 'P1-241');
    expect(again.report.added).toBe(1);
    expect(again.report.missing.map((row) => row.rowId)).toEqual([luce.rowId]);
    const kept = again.merge.rows.find((row) => row.rowId === luce.rowId);
    expect(kept).toMatchObject({ missingFromLastImport: true, rowIndex: 28 });
    expect(again.campaign.columnOrder.at(-1)).toBe('Nouvelle colonne');
    expect(again.campaign.columnGroups['Nouvelle colonne']).toBe('person');
  });

  it('follows the order of the new file', () => {
    const reversed = parseFixture('public/cases.kmz');
    const file = {
      ...reversed,
      rows: [...reversed.rows].reverse().map((row, i) => ({ ...row, sourceIndex: i })),
    };
    const again = importInto(file, first);
    expect(again.merge.rows[0]?.parcelIdRaw).toBe('PT9-021');
    expect(again.report).toMatchObject({ added: 0, updated: 0, unchanged: 28 });
  });

  it('keeps a position when the new file has only the address', () => {
    const file = fileWith((row) =>
      row.parcelIdRaw === 'P1-222'
        ? { ...row, position: null, addressText: '10, rue Principale' }
        : row,
    );
    const again = importInto(file, first);
    expect(rowByParcel(again, 'P1-222').position).toEqual(rowByParcel(first, 'P1-222').position);
  });

  it('offers a new campaign when most parcel IDs are unknown', () => {
    const other = importInto(parseFixture('public/big-2000.kmz'), first);
    expect(other.report.mostlyNewParcelIds).toBe(true);
    expect(importInto(parseFixture('public/cases.kmz'), first).report.mostlyNewParcelIds).toBe(
      false,
    );
  }, 30_000);
});

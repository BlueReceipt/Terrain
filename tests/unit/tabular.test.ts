import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { withParcelIdColumn } from '../../src/domain/importPlan.ts';
import { decodeText, parseTabular } from '../../src/domain/tabular.ts';

function xlsx(sheets: Record<string, unknown[][]>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Windows-1252 bytes; for the accented letters of French these equal their Latin-1 code points. */
function windows1252(text: string): Uint8Array {
  return Uint8Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
}

describe('spreadsheets with coordinates', () => {
  it('reads "Latitude"/"Longitude" and keeps every column as text', () => {
    const file = parseTabular(
      xlsx({
        Parcels: [
          ['Parcel ID', 'NUM_LOT', 'NOM', 'Latitude', 'Longitude'],
          ['P1-095B', '1 234 701', 'Sauceau', 45.3155, -73.8723],
          ['P1-096', 1234748, 'Vinaigre', '45.30', '-73.80'],
        ],
      }),
      'campaign.xlsx',
    );
    expect(file.format).toBe('tabular');
    expect(file.columns).toEqual(['Parcel ID', 'NUM_LOT', 'NOM', 'Latitude', 'Longitude']);
    expect(file.rows.map((row) => row.parcelIdRaw)).toEqual(['P1-095B', 'P1-096']);
    expect(file.rows[0]?.position).toEqual({ lat: 45.3155, lng: -73.8723 });
    expect(file.rows[1]?.fields.NUM_LOT).toBe('1234748');
    expect(file.layers).toEqual(['Parcels']);
  });

  it('accepts the other coordinate header variants', () => {
    for (const [lat, lng] of [
      ['lat', 'lng'],
      ['LAT', 'LONG'],
      ['Lat', 'Lon'],
      ['Y', 'X'],
    ] as const) {
      const file = parseTabular(
        xlsx({
          S: [
            ['Parcel', lat, lng],
            ['A-1', 45.1, -73.2],
          ],
        }),
        'x.xlsx',
      );
      expect(file.rows[0]?.position).toEqual({ lat: 45.1, lng: -73.2 });
    }
  });

  it('reads a WKT point column, and a decimal comma', () => {
    const file = parseTabular(
      xlsx({
        S: [
          ['Parcel ID', 'WKT'],
          ['A-1', 'POINT (-73.2 45.1)'],
        ],
      }),
      'x.xlsx',
    );
    expect(file.rows[0]?.position).toEqual({ lat: 45.1, lng: -73.2 });
    const comma = parseTabular(
      xlsx({
        S: [
          ['Parcel ID', 'Latitude', 'Longitude'],
          ['A-1', '45,1', '-73,2'],
        ],
      }),
      'x.xlsx',
    );
    expect(comma.rows[0]?.position).toEqual({ lat: 45.1, lng: -73.2 });
  });

  it('refuses a file without coordinates, with directions', () => {
    expect(() =>
      parseTabular(
        xlsx({
          S: [
            ['Parcel ID', 'NOM'],
            ['A-1', 'Sauceau'],
          ],
        }),
        'x.xlsx',
      ),
    ).toThrow(expect.objectContaining({ code: 'no-coordinates' }) as Error);
  });

  it('lets the mapping screen choose the parcel ID column', () => {
    const file = parseTabular(
      xlsx({
        S: [
          ['Lot', 'Latitude', 'Longitude'],
          ['A-1', 45.1, -73.2],
        ],
      }),
      'x.xlsx',
    );
    expect(file.rows[0]?.parcelIdRaw).toBe('');
    expect(withParcelIdColumn(file, 'Lot').rows[0]?.parcelIdRaw).toBe('A-1');
  });
});

describe('CSV encodings', () => {
  it('detects Windows-1252 and UTF-8', () => {
    expect(decodeText(windows1252('Saint-Étienne, Québec'))).toBe('Saint-Étienne, Québec');
    expect(decodeText(new TextEncoder().encode('Saint-Étienne, Québec'))).toBe(
      'Saint-Étienne, Québec',
    );
  });

  it('parses a Windows-1252 CSV from Excel with accents intact', () => {
    const csv = windows1252(
      'Parcel ID,NOM,MUNICIPALITE,Latitude,Longitude\r\nP1-099,Lafromagé,Saint-Élie-de-Caxton,45.3,-73.8\r\n',
    );
    const file = parseTabular(csv, 'export.csv');
    expect(file.rows[0]?.fields).toMatchObject({
      NOM: 'Lafromagé',
      MUNICIPALITE: 'Saint-Élie-de-Caxton',
    });
    expect(file.layers).toEqual(['export']);
  });

  it('keeps CSV values as written, dates and leading zeros included', () => {
    const csv = new TextEncoder().encode(
      'Parcel ID,Visit date,Code,Latitude,Longitude\nP1-1,14-july,0288,45.3,-73.8\n',
    );
    expect(parseTabular(csv, 'x.csv').rows[0]?.fields).toMatchObject({
      'Visit date': '14-july',
      Code: '0288',
    });
  });
});

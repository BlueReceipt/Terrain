import { describe, expect, it } from 'vitest';
import {
  houseNumbers,
  phoneColumns,
  phoneNumbersIn,
  rowsListingNumber,
  samePhone,
  type HouseNumber,
} from '../../src/domain/calls.ts';
import { detectRoles } from '../../src/domain/columns.ts';
import { fileDate, formatCell, formatTime, isTerrainTime } from '../../src/domain/format.ts';
import { COLUMNS } from '../../scripts/make-fixtures.ts';
import { houseOf, miniCampaign, rowOf } from '../support/campaign.ts';
import { importInto, parseFixture } from '../support/import.ts';

describe('dates Terrain writes', () => {
  it('shows the time of the tap in the chosen format (Alex: 26.09.2026 14:32)', () => {
    const tap = '2026-09-26T14:32:05-04:00';
    expect(formatTime(tap, 'DD.MM.YYYY HH:mm')).toBe('26.09.2026 14:32');
    expect(formatTime(tap, 'YYYY-MM-DD HH:mm')).toBe('2026-09-26 14:32');
    expect(formatTime(tap, 'DD/MM/YYYY HH:mm')).toBe('26/09/2026 14:32');
    // The wall-clock time where Alex tapped, whatever the device's time zone is now.
    expect(formatTime('2026-07-14T08:05:00-05:00', 'DD.MM.YYYY HH:mm')).toBe('14.07.2026 08:05');
    expect(fileDate(tap)).toBe('2026-09-26');
  });

  it('leaves dates typed in the client’s file exactly as typed', () => {
    for (const typed of [
      '14.07',
      '14 juillet',
      '24.09 and 25.09',
      '2026-09-26',
      'Vendu ya 2 ans',
    ]) {
      expect(isTerrainTime(typed)).toBe(false);
      expect(formatCell(typed, 'DD.MM.YYYY HH:mm')).toBe(typed);
    }
    expect(formatCell('2026-09-26T14:32:00Z', 'DD.MM.YYYY HH:mm')).toBe('26.09.2026 14:32');
  });
});

describe('phone numbers', () => {
  it('finds every number in a cell, however it is written', () => {
    expect(phoneNumbersIn('450 555-0100')).toEqual(['4505550100']);
    expect(phoneNumbersIn('(450) 555-0123 poste 2')).toEqual(['4505550123']);
    expect(phoneNumbersIn('+1 514.555.0199')).toEqual(['5145550199']);
    expect(phoneNumbersIn('450-555-0100 / 514-555-0199')).toEqual(['4505550100', '5145550199']);
    expect(phoneNumbersIn('555-0100')).toEqual(['5550100']);
    expect(phoneNumbersIn('')).toEqual([]);
  });

  it('matches one number written two ways', () => {
    expect(samePhone('450 555-0100', '(450) 555 0100')).toBe(true);
    expect(samePhone('5550100', '450 555-0100')).toBe(true);
    expect(samePhone('450 555-0100', '450 555-0101')).toBe(false);
    expect(samePhone('', '')).toBe(false);
  });

  it('reads the phone columns, not the fax', () => {
    expect(phoneColumns(COLUMNS, detectRoles(COLUMNS))).toEqual([
      'Contact number',
      'TEL_RES',
      'CELLULAIRE',
      'TEL_BUR',
    ]);
    expect(
      phoneColumns(['Tél. rés. 2', 'Cellulaire 2', 'Courriel 2', 'Contact locataire'], {}),
    ).toEqual(['Tél. rés. 2', 'Cellulaire 2']);
  });

  it('finds the rows at a house that list a number: the home line all of them, a cell one', () => {
    const rows = importInto(parseFixture('public/cases.kmz')).merge.rows;
    const alain = rowOf(rows, 'P1-216B', 'Alain');
    const house = houseOf(rows, alain);
    const columns = phoneColumns(COLUMNS, detectRoles(COLUMNS));
    expect(rowsListingNumber(house, '4505550100', columns)).toHaveLength(3);
    expect(
      rowsListingNumber(house, '514-555-0199', columns).map((row) => row.sourceFields.PRENOM),
    ).toEqual(['Marie']);
    expect(rowsListingNumber(house, '819 555-0000', columns)).toEqual([]);
  });

  const listed = (numbers: readonly HouseNumber[]) =>
    numbers.map(({ display, digits, kind, owners, rowIds }) => ({
      display,
      digits,
      kind,
      owners,
      rows: rowIds.length,
    }));

  it('lists each number at a house once, in file order, with whom it reaches (§5.3 Call)', () => {
    const rows = importInto(parseFixture('public/cases.kmz')).merge.rows;
    const house = houseOf(rows, rowOf(rows, 'P1-216B', 'Alain'));
    const numbers = houseNumbers(
      house,
      COLUMNS,
      detectRoles(COLUMNS),
      (row) => `${row.sourceFields.PRENOM ?? ''} ${row.sourceFields.NOM ?? ''}`,
    );
    expect(listed(numbers)).toEqual([
      { display: '450 555-0100', digits: '4505550100', kind: 'home', owners: [], rows: 3 },
      {
        display: '450 555-0123',
        digits: '4505550123',
        kind: 'cell',
        owners: ['Alain Trempette'],
        rows: 2,
      },
      {
        display: '514 555-0199',
        digits: '5145550199',
        kind: 'cell',
        owners: ['Marie Trempette'],
        rows: 1,
      },
    ]);
  });

  it('names a number once however each row writes it, and splits a cell holding two', () => {
    // Two poutine places from the restaurant list sharing a home line and one cell.
    const rows = miniCampaign([
      {
        parcel: 'P1-300',
        company: 'Cantine la patate a Patou',
        address: '170 2e Rang',
        home: '819 555-0140',
        cell: '819 555-0141 / 418 555-0142',
      },
      {
        parcel: 'P1-300',
        company: 'La Poutinerie',
        address: '170 2e Rang',
        home: '(819) 555-0140',
        cell: '819-555-0141',
      },
    ]).merge.rows;
    const numbers = houseNumbers(
      rows,
      COLUMNS,
      detectRoles(COLUMNS),
      (row) => row.sourceFields.Propriétaire ?? '',
    );
    expect(listed(numbers)).toEqual([
      { display: '819 555-0140', digits: '8195550140', kind: 'home', owners: [], rows: 2 },
      {
        display: '819 555-0141',
        digits: '8195550141',
        kind: 'cell',
        owners: ['Cantine la patate a Patou', 'La Poutinerie'],
        rows: 2,
      },
      {
        display: '418 555-0142',
        digits: '4185550142',
        kind: 'cell',
        owners: ['Cantine la patate a Patou'],
        rows: 1,
      },
    ]);
    expect(houseNumbers(rows, ['ADRESSE'], detectRoles(COLUMNS), () => '')).toEqual([]);
  });
});

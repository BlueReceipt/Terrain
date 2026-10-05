import { describe, expect, it } from 'vitest';
import { addressParts } from '../../src/domain/address.ts';
import {
  groupHouses,
  metersBetween,
  sharedPoints,
  spreadHouses,
  type IdentityInput,
} from '../../src/domain/identity.ts';
import { withLotColumn, withOldParcelIds } from '../../src/domain/importPlan.ts';
import type { LatLng } from '../../src/domain/types.ts';
import { importInto, parseFixture, rowByParcel } from '../support/import.ts';

const at = (lat: number, lng: number): LatLng => ({ lat, lng });
const east = (p: LatLng, meters: number): LatLng => ({
  lat: p.lat,
  lng: p.lng + meters / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
});
const noAddress = addressParts(() => '');
const input = (
  rowId: string,
  rowIndex: number,
  position: LatLng | null,
  lotKeys: string[],
  street = '',
): IdentityInput => ({
  rowId,
  rowIndex,
  position,
  lotKeys,
  address: street ? addressParts((role) => (role === 'street' ? street : '')) : noAddress,
});

describe('groupHouses', () => {
  const home = at(45.2641, -73.6105);

  it('joins blank-address rows within 5 m that share a parcel, and only those', () => {
    const houses = groupHouses([
      input('a', 0, home, ['P1-1']),
      input('b', 1, east(home, 4), ['P1-1']),
      input('c', 2, east(home, 3), ['P1-9']),
    ]);
    expect(houses.map((house) => house.rowIds)).toEqual([['a', 'b'], ['c']]);
  });

  it('is transitive, and keeps the key of the first row in file order', () => {
    const houses = groupHouses([
      input('late', 5, null, ['X'], '5 route Centrale'),
      input('first', 1, null, ['Y'], '5, route Centrale'),
      input('middle', 3, null, ['Z'], '5 route centrale'),
    ]);
    expect(houses).toHaveLength(1);
    expect(houses[0]).toMatchObject({
      houseKey: 'h:first',
      rowIds: ['first', 'middle', 'late'],
      position: null,
    });
  });

  it('places a house where most of its rows are; a tie goes to the first row', () => {
    const [majority] = groupHouses([
      input('a', 0, east(home, 300), ['L'], '1 rue A'),
      input('b', 1, home, ['L'], '1 rue A'),
      input('c', 2, east(home, 2), ['L'], '1 rue A'),
    ]);
    expect(majority?.position).toEqual(home);
    const [tie] = groupHouses([
      input('a', 0, east(home, 300), ['L'], '1 rue A'),
      input('b', 1, home, ['L'], '1 rue A'),
    ]);
    expect(tie?.position).toEqual(east(home, 300));
  });

  it('reports different houses at one point, and houses whose rows are far apart', () => {
    const houses = groupHouses([
      input('a', 0, home, ['1'], '10 rue Principale'),
      input('b', 1, east(home, 1), ['2'], '22 rue Principale'),
      input('c', 2, east(home, 500), ['3'], '5 rue Autre'),
      input('d', 3, east(home, 600), ['3'], '5 rue Autre'),
    ]);
    expect(sharedPoints(houses).map((group) => group.flatMap((house) => house.rowIds))).toEqual([
      ['a', 'b'],
    ]);
    const positions = new Map([
      ['a', home],
      ['b', east(home, 1)],
      ['c', east(home, 500)],
      ['d', east(home, 600)],
    ]);
    expect(spreadHouses(houses, positions).map((house) => house.rowIds)).toEqual([['c', 'd']]);
  });

  it('measures meters on the ground', () => {
    expect(metersBetween(home, east(home, 50))).toBeCloseTo(50, 1);
  });
});

describe('the house and lot cases (fixtures/public/cases.kmz)', () => {
  const plan = importInto(parseFixture('public/cases.kmz'));
  const report = plan.report;
  const houseOf = (parcel: string, lastName?: string) =>
    rowByParcel(plan, parcel, lastName).houseKey;

  it('imports every row, in file order, with nothing dropped or merged away', () => {
    expect(plan.merge.rows).toHaveLength(28);
    expect(plan.merge.rows.map((row) => row.rowIndex)).toEqual([...Array(28).keys()]);
    expect(report.added).toBe(28);
    expect(plan.parsed.layers).toEqual(['Cases layer', 'Second layer']);
    expect(report.referenceFeatures).toBe(4);
  });

  it('makes husband, wife and the second parcel one house of 3 rows on 2 parcel IDs', () => {
    const house = report.housesWithSeveralRows.find((h) => h.address === '123, rue Saint-Paul');
    expect(house?.rows.map((row) => [row.parcelId, row.owner])).toEqual([
      ['P1-216B', 'Alain Trempette'],
      ['P1-216B', 'Marie Trempette'],
      ['P1-217A', 'Alain Trempette'],
    ]);
    expect(report.duplicates.flat().map((row) => row.parcelId)).not.toContain('P1-216B');
  });

  it('makes one house of an address typed two ways', () => {
    expect(houseOf('P1-220')).toBe(houseOf('P1-221'));
  });

  it('keeps two addresses at one point as two houses, reported as a shared point', () => {
    expect(houseOf('P1-222')).not.toBe(houseOf('P1-223'));
    expect(report.sharedPoints.map((group) => group.map((house) => house.address))).toEqual([
      ['10, rue Principale', '22, rue Principale'],
    ]);
  });

  it('uses the postal code found in MUNICIPALITE, and keeps the same street in another town apart', () => {
    expect(houseOf('P08-095')).toBe(houseOf('P08-096'));
    expect(houseOf('P08-097')).not.toBe(houseOf('P08-095'));
  });

  it('forgives a typo in the town when the postal code is missing', () => {
    expect(houseOf('PT9-020')).toBe(houseOf('PT9-021'));
  });

  it('imports address-only pins without a position and lists their houses', () => {
    expect(rowByParcel(plan, 'P1-235', 'Saucier').position).toBeNull();
    expect(houseOf('P1-235', 'Saucier')).toBe(rowByParcel(plan, 'P1-235').houseKey);
    // Sorted by town: Amqui, Lachute, Saint-Isidore.
    expect(report.housesWithoutPosition.map((h) => [h.address, h.town])).toEqual([
      ['60, rue Sainte-Anne', 'Amqui'],
      ['420, avenue Hamford', 'Lachute QC J8H 3P1'],
      ['420, avenue Hamford', 'Saint-Isidore'],
    ]);
  });

  it('counts the houses, and the lots at more than one house', () => {
    expect(report.houseCount).toBe(20);
    expect(report.housesWithSeveralRows).toHaveLength(7);
    expect(report.lotsAcrossHouses.map((lot) => lot.lotKey).sort()).toEqual([
      'P08-132A',
      'P1-216B',
    ]);
  });

  it('groups lots by NUM_LOT on request: "1 234 567" = "1234567", blanks never group', () => {
    const byNumLot = withLotColumn(plan, 'NUM_LOT');
    expect(byNumLot.report.lotsAcrossHouses.map((lot) => lot.lotKey).sort()).toEqual([
      '1234500',
      '1234567',
    ]);
    expect(rowByParcel(byNumLot, 'P1-232').lotKeys).toEqual([]);
    expect(rowByParcel(byNumLot, 'P1-233').lotKeys).toEqual([]);
  });

  it('lists cells with several parcel IDs; marking one old takes the row off that lot', () => {
    expect(report.severalParcelIds.map((entry) => entry.ids)).toEqual([['P08-132A', 'P08-132']]);
    const rita = rowByParcel(plan, 'P08-132A\nP08-132');
    const marked = withOldParcelIds(plan, rita.rowId, ['P08-132A']);
    expect(marked.report.lotsAcrossHouses.map((lot) => lot.lotKey)).toEqual(['P1-216B']);
    expect(marked.merge.rows.find((row) => row.rowId === rita.rowId)?.lotKeys).toEqual(['P08-132']);
  });

  it('keeps a true duplicate and lists it', () => {
    expect(report.duplicates.map((group) => group.map((row) => row.parcelId))).toEqual([
      ['P1-242', 'P1-242'],
    ]);
    expect(houseOf('P1-242')).toBe(
      plan.merge.rows.filter((r) => r.parcelIdRaw === 'P1-242')[1]?.houseKey,
    );
  });

  it('maps pin colors to statuses, and flags the color that matches none', () => {
    expect(rowByParcel(plan, 'P1-221').statusId).toBe('given');
    expect(rowByParcel(plan, 'P1-230').statusId).toBe('given');
    expect(rowByParcel(plan, 'P1-223').statusId).toBe('at-door');
    expect(rowByParcel(plan, 'P08-132A').statusId).toBe('to-research');
    expect(rowByParcel(plan, 'P08-132A\nP08-132').statusId).toBe('not-given');
    expect(rowByParcel(plan, 'P1-234').statusId).toBe('to-visit');
    expect(report.colors.find((color) => color.color === '#0F9D58')?.texts).toEqual([
      'Given to wife',
    ]);
  });

  it('keeps app-owned values and every column as imported', () => {
    const jean = rowByParcel(plan, 'P1-240');
    expect(jean).toMatchObject({
      callDate: '28 septembre',
      callResult: 'voicemail',
      importedNotes: 'Propriétaire unique, terrasse sur le côté',
    });
    expect(jean.sourceFields.Propriétaire).toBe('Lafromagé & fils');
    expect(plan.campaign.columnOrder[0]).toBe('Contact person');
    expect(plan.campaign.columnOrder).toHaveLength(24);
  });
});

describe('the 2,000-row fixture', () => {
  // A guard against grouping that grows out of hand (quadratic and worse), not a benchmark:
  // Alex's PC is often busy with OneDrive. Real speed is checked in the browser (e2e).
  it('imports 2,000 rows without blowing up, every row kept', () => {
    const started = performance.now();
    const plan = importInto(parseFixture('public/big-2000.kmz'));
    expect(plan.merge.rows).toHaveLength(2000);
    expect(plan.report.housesWithoutPosition.length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 30_000);
});

import { describe, expect, it } from 'vitest';
import {
  campaignArea,
  houseStatus,
  lotNeighbors,
  mapContent,
  statusCounts,
} from '../../src/domain/pins.ts';
import { search } from '../../src/domain/search.ts';
import { DEFAULT_STATUSES } from '../../src/domain/statuses.ts';
import type { Row } from '../../src/domain/types.ts';
import { gray } from '../../src/map/style.ts';
import { houseOf, rowOf } from '../support/campaign.ts';
import { importInto, parseFixture } from '../support/import.ts';

const plan = importInto(parseFixture('public/cases.kmz'));
const { campaign } = plan;
const rows = plan.merge.rows;
const alain = rowOf(rows, 'P1-216B', 'Alain');
const luc = rowOf(rows, 'P1-216B', 'Luc');
const status = (id: string) => DEFAULT_STATUSES.find((s) => s.id === id);

function as(row: Row, statusId: string, updatedAt: string): Row {
  return { ...row, statusId, updatedAt };
}

describe('pins', () => {
  it('show a house’s status: the one its rows share, else To visit, else the row changed last', () => {
    const [a, b, c] = houseOf(rows, alain);
    if (!a || !b || !c) throw new Error('The Trempette house has 3 rows');
    const at = '2026-09-26T10:00:00-04:00';
    const later = '2026-09-26T15:00:00-04:00';
    expect(houseStatus([as(a, 'given', at), as(b, 'given', at)], DEFAULT_STATUSES)).toBe(
      status('given'),
    );
    expect(
      houseStatus(
        [as(a, 'given', later), as(b, 'to-visit', at), as(c, 'at-door', at)],
        DEFAULT_STATUSES,
      ),
    ).toBe(status('to-visit'));
    expect(
      houseStatus(
        [as(a, 'given', at), as(b, 'at-door', later), as(c, 'to-research', at)],
        DEFAULT_STATUSES,
      ),
    ).toBe(status('at-door'));
  });

  it('are one per house, one per spot shared by several houses, with the rows or houses as their count', () => {
    const { pins, unplaced } = mapContent(rows, DEFAULT_STATUSES);
    expect(pins).toHaveLength(16);
    expect(unplaced).toHaveLength(3);
    const trempette = pins.find((pin) => pin.houseKeys.includes(alain.houseKey));
    expect(trempette).toMatchObject({ count: 3, houseKeys: [alain.houseKey], ring: false });
    const shared = pins.filter((pin) => pin.houseKeys.length > 1);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.count).toBe(2);
  });

  it('stay one per house on the 2,000-row fixture', () => {
    const big = mapContent(
      importInto(parseFixture('public/big-2000.kmz')).merge.rows,
      DEFAULT_STATUSES,
    );
    expect(big.pins).toHaveLength(414);
    expect(big.unplaced).toHaveLength(787);
  });

  it('draw a ring when every row was closed from its lot', () => {
    const closed = rows.map((row) =>
      row.houseKey === luc.houseKey
        ? { ...row, origin: { eventId: 'e', fromHouseKey: alain.houseKey } }
        : row,
    );
    const pin = mapContent(closed, DEFAULT_STATUSES).pins.find((p) =>
      p.houseKeys.includes(luc.houseKey),
    );
    expect(pin?.ring).toBe(true);
  });

  it('filter to the houses holding at least one row with a status; chip counts are rows', () => {
    const mixed = rows.map((row) =>
      row.rowId === alain.rowId ? { ...row, statusId: 'given' } : row,
    );
    const given = mapContent(mixed, DEFAULT_STATUSES, 'given').pins;
    expect(given.some((pin) => pin.houseKeys.includes(alain.houseKey))).toBe(true);
    expect(statusCounts(mixed).get('given')).toBe(
      (statusCounts(rows).get('given') ?? 0) + (alain.statusId === 'given' ? 0 : 1),
    );
  });

  it('tether the selected house to the other houses on its lots', () => {
    expect(lotNeighbors(rows, alain.houseKey)).toEqual([luc.houseKey]);
  });

  it('copy the campaign area padded by 2 km, as the basemap script takes it', () => {
    expect(campaignArea([-73.61, 45.26, -73.59, 45.28])).toBe(
      '-73.63553,45.24203,-73.56447,45.29797',
    );
    expect(campaignArea(null)).toBeNull();
  });
});

describe('search', () => {
  it('finds parcel IDs however they are typed', () => {
    const found = search(rows, campaign, 'p1-216b');
    expect(found.filter((result) => result.kind === 'row').map((result) => result.match)).toEqual([
      'parcel',
      'parcel',
      'parcel',
    ]);
  });

  it('finds owners and addresses without accents or punctuation', () => {
    const owners = search(rows, campaign, 'trempette');
    expect(
      owners.some((result) => result.kind === 'row' && result.name === 'Marie Trempette'),
    ).toBe(true);
    const street = search(rows, campaign, 'rue saint paul');
    expect(street[0]).toMatchObject({ kind: 'row', match: 'address', houseKey: alain.houseKey });
  });

  it('lists every house of a lot number', () => {
    const [lot] = search(rows, campaign, '1 234 500');
    expect(lot).toMatchObject({ kind: 'lot', column: 'NUM_LOT', value: '1 234 500' });
    expect(lot?.kind === 'lot' && lot.houseKeys).toEqual([alain.houseKey, luc.houseKey]);
  });

  it('searches corrected values', () => {
    const corrected = rows.map((row) =>
      row.rowId === luc.rowId ? { ...row, edits: { PRENOM: 'Lucien' } } : row,
    );
    expect(search(corrected, campaign, 'lucien')).toHaveLength(1);
    expect(search(rows, campaign, 'lucien')).toHaveLength(0);
  });

  it('waits for two characters', () => {
    expect(search(rows, campaign, 'p')).toEqual([]);
  });
});

describe('the basemap colors (desaturated)', () => {
  it('turns each color to the gray of its lightness', () => {
    expect(gray('#80deea')).toBe('#cbcbcb');
    expect(gray('#ffffff')).toBe('#ffffff');
    expect(gray('rgba(0,0,0,0.5)')).toBe('rgba(0,0,0,0.5)');
  });
});

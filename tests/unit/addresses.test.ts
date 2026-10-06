import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  addressKey,
  housesToFind,
  placementFor,
  type AddressCandidate,
  type AddressQuery,
} from '../../src/domain/addresses.ts';
import { withPlacements } from '../../src/domain/importPlan.ts';
import { parseTabular } from '../../src/domain/tabular.ts';
import { importInto } from '../support/import.ts';

function xlsx(sheets: Record<string, unknown[][]>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const query = (street: string, town: string, postalCode = '', province = 'QC'): AddressQuery => ({
  street,
  town,
  postalCode,
  province,
});

const candidate = (
  number: string,
  street: string,
  town: string,
  postalCode = '',
  lat = 46.8113,
  lng = -71.2176,
): AddressCandidate => ({ lat, lng, number, street, town, postalCode });

describe('where an address puts a house', () => {
  const house = candidate('780', 'Rue Saint-Jean', 'Québec', 'G1R1P9');
  const street = candidate('', 'Rue Saint-Jean', 'Québec', '', 46.8131, -71.2124);
  const bosco = candidate('', 'Rue Saint-Jean-Bosco', 'Québec', '', 46.7882, -71.2709);

  it('at the civic number when the service has it, else on the street', () => {
    expect(placementFor(query('780, rue Saint-Jean', 'Québec'), [street, house])).toEqual({
      position: { lat: 46.8113, lng: -71.2176 },
      precision: 'address',
    });
    expect(placementFor(query('782, rue Saint-Jean', 'Québec'), [street, house])).toEqual({
      position: { lat: 46.8131, lng: -71.2124 },
      precision: 'street',
    });
  });

  it('reads street and town names however the file spells them', () => {
    expect(placementFor(query('780 R. St-Jean', 'QUEBEC'), [house])?.precision).toBe('address');
    const lac = candidate('12', 'Chemin du Lac', 'Saint-Hyacinthe');
    expect(placementFor(query('12, ch. du lac', 'St-Hyacinthe'), [lac])?.precision).toBe('address');
  });

  it('never takes another street, or the same street in another town', () => {
    expect(placementFor(query('5, rue Saint-Jean', 'Québec'), [bosco])).toBeNull();
    const elsewhere = candidate('', 'Rang Double', 'Sainte-Julie');
    expect(placementFor(query('1 rang Double', 'Saint-Hyacinthe'), [elsewhere])).toBeNull();
  });

  it('takes a town the service spells differently when the postal code is the same', () => {
    const merged = candidate('780', 'Rue Saint-Jean', 'Québec', 'G1R1P9');
    expect(
      placementFor(query('780, rue Saint-Jean', 'Vieux-Québec', 'g1r 1p9'), [merged])?.precision,
    ).toBe('address');
  });

  it('puts a house outside Québec where the federal service estimates it: on the street', () => {
    const estimated = { ...candidate('111', 'Wellington Street', 'Ottawa'), estimated: true };
    const west = {
      ...candidate('', 'Wellington Street West', 'Ottawa', '', 45.4),
      estimated: true,
    };
    expect(
      placementFor(query('111 Wellington St.', 'Ottawa', '', 'ON'), [west, estimated]),
    ).toEqual({ position: { lat: 46.8113, lng: -71.2176 }, precision: 'street' });
  });

  it('tells street types apart in English and French, and lets a file leave the type out', () => {
    const terrace = { ...candidate('50', 'Rideau Terrace', 'Ottawa'), estimated: true };
    expect(placementFor(query('50 Rideau St', 'Ottawa', '', 'ON'), [terrace])).toBeNull();
    const maple = candidate('', 'Maple Drive', 'Kanata');
    expect(placementFor(query('12 Maple Dr', 'Kanata', '', 'ON'), [maple])?.precision).toBe(
      'street',
    );
    expect(placementFor(query('780 Saint-Jean', 'Québec'), [house])?.precision).toBe('address');
    expect(placementFor(query('780 av. Saint-Jean', 'Québec'), [house])).toBeNull();
  });

  it('keys an address the same however it is written', () => {
    expect(addressKey(query('780, rue Saint-Jean', 'Québec', 'G1R 1P8'))).toBe(
      addressKey(query('780 Rue St-Jean', 'QUÉBEC', 'G1R 1P8')),
    );
  });
});

describe('houses found from their addresses', () => {
  // The poutine sample's addresses, in a spreadsheet with no coordinates.
  const parsed = parseTabular(
    xlsx({
      Cantines: [
        ['Parcel ID', 'NOM', 'ADRESSE', 'MUNICIPALITE', 'PROVINCE', 'CODE_POSTAL', 'TEL_RES'],
        [
          'P1-001',
          'Snack-bar St-Jean',
          '780, rue Saint-Jean',
          'Québec',
          'QC',
          'G1R 1P8',
          '418 555-0101',
        ],
        [
          'P1-002',
          'Casse-croûte du Lac',
          '12, chemin du Lac',
          'Saint-Hyacinthe',
          'QC',
          '',
          '450 555-0102',
        ],
        ['P1-003', 'Frites Ontario', '1 Main Street', 'Ottawa', 'ON', '', '613 555-0103'],
        ['P1-004', 'Sans adresse', '', '', 'QC', '', '450 555-0104'],
        ['P1-005', 'Poutine du Vermont', '1 Church St', 'Burlington', 'VT', '', '802 555-0105'],
      ],
    }),
    'cantines.xlsx',
  );
  const plan = importInto(parsed);

  it('looks up each house without a position, in Canada, by its address only', () => {
    const asked = housesToFind(plan.merge.rows, plan.merge.houses, plan.campaign.roles);
    expect(asked.map((house) => house.query)).toEqual([
      query('780, rue Saint-Jean', 'Québec', 'G1R 1P8'),
      query('12, chemin du Lac', 'Saint-Hyacinthe'),
      query('1 Main Street', 'Ottawa', '', 'ON'),
    ]);
  });

  it('puts the found houses on the map, marked, and counts them on the report', () => {
    const [snack, lac] = housesToFind(plan.merge.rows, plan.merge.houses, plan.campaign.roles);
    const placed = withPlacements(
      plan,
      new Map([
        [
          snack?.houseKey ?? '',
          { position: { lat: 46.8113, lng: -71.2176 }, precision: 'address' },
        ],
        [lac?.houseKey ?? '', { position: { lat: 45.6307, lng: -72.9567 }, precision: 'street' }],
      ] as const),
    );
    expect(placed.merge.rows.map((row) => row.placed)).toEqual([
      'address',
      'street',
      null,
      null,
      null,
    ]);
    expect(placed.merge.rows[0]?.importedPosition).toEqual({ lat: 46.8113, lng: -71.2176 });
    expect(placed.report.placedAtAddress).toBe(1);
    expect(placed.report.placedOnStreet.map((house) => house.address)).toEqual([
      '12, chemin du Lac',
    ]);
    expect(placed.report.housesWithoutPosition).toHaveLength(3);
    expect(placed.campaign.bounds).toEqual([-72.9567, 45.6307, -71.2176, 46.8113]);
  });

  it('keeps a found position when the same file comes back without coordinates', () => {
    const [snack] = housesToFind(plan.merge.rows, plan.merge.houses, plan.campaign.roles);
    const placed = withPlacements(
      plan,
      new Map([
        [
          snack?.houseKey ?? '',
          { position: { lat: 46.8113, lng: -71.2176 }, precision: 'address' },
        ],
      ] as const),
    );
    const again = importInto(parsed, placed);
    const first = again.merge.rows.find((row) => row.parcelIdRaw === 'P1-001');
    expect(first).toMatchObject({ placed: 'address', position: { lat: 46.8113, lng: -71.2176 } });
    expect(again.report.conflicts).toEqual([]);
  });
});

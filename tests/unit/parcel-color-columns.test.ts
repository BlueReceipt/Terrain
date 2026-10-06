import { describe, expect, it } from 'vitest';
import {
  colorFamily,
  colorFromStyleId,
  kmlColorToHex,
  suggestStatus,
  textOn,
} from '../../src/domain/color.ts';
import { defaultColumnGroups, detectRoles, headerKey } from '../../src/domain/columns.ts';
import { lotKeysOf, splitParcelIds } from '../../src/domain/parcel.ts';
import { DEFAULT_STATUSES, statusForPackageText } from '../../src/domain/statuses.ts';

describe('parcel ID cells', () => {
  it('splits several IDs on new lines, commas, slashes and spaces between IDs', () => {
    expect(splitParcelIds('P1-096\nP1-097\nP1-097A\nP1-097B')).toEqual([
      'P1-096',
      'P1-097',
      'P1-097A',
      'P1-097B',
    ]);
    expect(splitParcelIds('P1-159, P1-160 P1-160A')).toEqual(['P1-159', 'P1-160', 'P1-160A']);
    expect(splitParcelIds('P09-007-9 / P09-007A-1')).toEqual(['P09-007-9', 'P09-007A-1']);
    expect(splitParcelIds(' P1-095B ')).toEqual(['P1-095B']);
  });

  it('expands shorthand like "PT7-012/011/010", and unwraps an ID in parentheses', () => {
    expect(splitParcelIds('PT7-012/011/010')).toEqual(['PT7-012', 'PT7-011', 'PT7-010']);
    expect(splitParcelIds('PT6-028/026')).toEqual(['PT6-028', 'PT6-026']);
    expect(splitParcelIds('P1-198/199A')).toEqual(['P1-198', 'P1-199A']);
    expect(splitParcelIds('P10-005-ADJ-1 (P10-5AP)')).toEqual(['P10-005-ADJ-1', 'P10-5AP']);
    expect(splitParcelIds('1 234 748/1 234 751')).toEqual(['1 234 748', '1 234 751']);
  });

  it('drops a note in parentheses after an ID', () => {
    expect(splitParcelIds('P10-8\nP10-7 (petite terrasse ajoutée en 2024)')).toEqual([
      'P10-8',
      'P10-7',
    ]);
  });

  it('keeps a spaced cadastre number whole', () => {
    expect(splitParcelIds('1 234 701')).toEqual(['1 234 701']);
    expect(splitParcelIds('4 714 948\n4 714 951')).toEqual(['4 714 948', '4 714 951']);
  });

  it('gives no lot keys for a blank cell, and leaves out IDs marked old', () => {
    expect(lotKeysOf('')).toEqual([]);
    expect(lotKeysOf('  \n ')).toEqual([]);
    expect(lotKeysOf('P08-132A\nP08-132', ['P08-132A'])).toEqual(['P08-132']);
    expect(lotKeysOf('1 234 567')).toEqual(lotKeysOf('1234567'));
  });
});

describe('pin colors', () => {
  it('reverses KML aabbggrr', () => {
    expect(kmlColorToHex('ffd18802')).toBe('#0288D1');
    expect(kmlColorToHex('ff589d0f')).toBe('#0F9D58');
    expect(kmlColorToHex('nonsense')).toBeNull();
  });

  it('falls back to the RGB in My Maps style ids', () => {
    expect(colorFromStyleId('icon-1899-0288D1')).toBe('#0288D1');
    expect(colorFromStyleId('icon-1899-FFEA00-normal')).toBe('#FFEA00');
    expect(colorFromStyleId('icon-ci-22-nodesc')).toBeNull();
  });

  it("sorts Alex's 19 colors into families", () => {
    for (const green of ['#7CB342', '#0F9D58', '#AFB42B', '#558B2F', '#097138'])
      expect(colorFamily(green)).toBe('green');
    for (const yellow of ['#FFEA00', '#FFD600', '#FBC02D', '#F9A825'])
      expect(colorFamily(yellow)).toBe('yellow');
    for (const red of ['#FF5252', '#C2185B', '#880E4F', '#A52714'])
      expect(colorFamily(red)).toBe('red');
    for (const blue of ['#0288D1', '#006064']) expect(colorFamily(blue)).toBe('blue');
    expect(colorFamily('#000000')).toBe('black');
    expect(colorFamily('#424242')).toBe('black');
    expect(colorFamily('#757575')).toBe('grey');
  });

  it('suggests the status of the same family, and nothing for a lone grey', () => {
    expect(suggestStatus('#7CB342', DEFAULT_STATUSES)?.id).toBe('given');
    expect(suggestStatus('#FBC02D', DEFAULT_STATUSES)?.id).toBe('at-door');
    expect(suggestStatus('#C2185B', DEFAULT_STATUSES)?.id).toBe('to-research');
    expect(suggestStatus('#424242', DEFAULT_STATUSES)?.id).toBe('not-given');
    expect(suggestStatus('#0288D1', DEFAULT_STATUSES)?.id).toBe('to-visit');
    expect(suggestStatus('#757575', DEFAULT_STATUSES)).toBeNull();
  });

  it('keeps purple (Skipped) apart: none of Alex’s 19 colors falls in it', () => {
    expect(colorFamily('#9C27B0')).toBe('purple');
    expect(suggestStatus('#7B1FA2', DEFAULT_STATUSES)?.id).toBe('skipped');
    for (const pink of ['#C2185B', '#880E4F']) expect(colorFamily(pink)).toBe('red');
  });
});

describe('text on a status color', () => {
  // WCAG 2 contrast, computed here on its own to check the app's choice.
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const contrast = (a: string, b: string) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
  };

  it('writes black or white, whichever contrasts more, and it always passes AA', () => {
    const steps = ['00', '33', '66', '99', 'CC', 'FF'];
    for (const r of steps)
      for (const g of steps)
        for (const b of steps) {
          const color = `#${r}${g}${b}`;
          const text = textOn(color);
          const other = text === '#000000' ? '#FFFFFF' : '#000000';
          expect(contrast(color, text)).toBeGreaterThanOrEqual(contrast(color, other));
          expect(contrast(color, text)).toBeGreaterThanOrEqual(4.5);
        }
  });

  it('labels the rail: black on Given, At door and To research, white on Skipped', () => {
    const on = (id: string) =>
      textOn(DEFAULT_STATUSES.find((status) => status.id === id)?.color ?? '');
    expect(['given', 'at-door', 'to-research', 'skipped', 'not-given'].map(on)).toEqual([
      '#000000',
      '#000000',
      '#000000',
      '#FFFFFF',
      '#FFFFFF',
    ]);
  });
});

describe('Package status texts', () => {
  it('reads "Given to wife" as Given and ignores unknown texts', () => {
    expect(statusForPackageText('Given to wife', DEFAULT_STATUSES)?.id).toBe('given');
    expect(statusForPackageText('at door.', DEFAULT_STATUSES)?.id).toBe('at-door');
    expect(statusForPackageText('In mail box', DEFAULT_STATUSES)).toBeNull();
    expect(statusForPackageText('', DEFAULT_STATUSES)).toBeNull();
  });
});

describe('column matching', () => {
  const alexColumns = [
    'Contact person',
    'Contact number',
    'Notes',
    'Anc_lot',
    'NUM_LOT',
    'Propriétaire',
    'APPEL',
    'PRENOM',
    'NOM',
    'ADRESSE',
    'MUNICIPALITE',
    'PROVINCE',
    'CODE_POSTAL',
    'TEL_RES',
    'CELLULAIRE',
    'TEL_BUR',
    'TELECOPIEUR',
    'COURRIEL',
    'Visit date',
    'Package status',
    'Call date',
    'call result',
    'Row location',
    'Language',
    'c/o / attn to',
    'Notes (source)',
    'Locataire',
    'Adresse 2',
    'Code postal 2',
  ];

  it('ignores case, accents, spaces and underscores', () => {
    expect(headerKey('Code postal')).toBe(headerKey('CODE_POSTAL'));
    expect(headerKey('Propriétaire')).toBe('proprietaire');
    expect(headerKey('Parcel ID')).toBe('parcelid');
  });

  it("recognizes every role in Alex's layers", () => {
    expect(detectRoles(alexColumns)).toEqual({
      packageStatus: 'Package status',
      visitDate: 'Visit date',
      callDate: 'Call date',
      callResult: 'call result',
      notes: 'Notes',
      street: 'ADRESSE',
      town: 'MUNICIPALITE',
      province: 'PROVINCE',
      postalCode: 'CODE_POSTAL',
      salutation: 'APPEL',
      firstName: 'PRENOM',
      lastName: 'NOM',
      company: 'Propriétaire',
      homePhone: 'TEL_RES',
      cellPhone: 'CELLULAIRE',
      workPhone: 'TEL_BUR',
      email: 'COURRIEL',
    });
  });

  it('recognizes spreadsheet parcel ID and coordinate headers', () => {
    expect(detectRoles(['RoW_No', 'Latitude', 'Longitude'])).toMatchObject({
      parcelId: 'RoW_No',
      lat: 'Latitude',
      lng: 'Longitude',
    });
    expect(detectRoles(['Parcel', 'LAT', 'LONG'])).toMatchObject({
      parcelId: 'Parcel',
      lat: 'LAT',
      lng: 'LONG',
    });
    expect(detectRoles(['Parcel ID', 'lat', 'lng'])).toMatchObject({
      parcelId: 'Parcel ID',
      lat: 'lat',
      lng: 'lng',
    });
    expect(detectRoles(['Parcel ID', 'WKT'])).toMatchObject({ parcelId: 'Parcel ID', wkt: 'WKT' });
  });

  it('groups columns by parcel and by owner: address and phones belong to each owner (Alex, 2026-10-01)', () => {
    const groups = defaultColumnGroups(alexColumns, detectRoles(alexColumns));
    expect(Object.values(groups)).not.toContain('house');
    expect(groups).toMatchObject({
      ADRESSE: 'person',
      TEL_RES: 'person',
      MUNICIPALITE: 'person',
      CODE_POSTAL: 'person',
      Anc_lot: 'parcel',
      NUM_LOT: 'parcel',
      'Row location': 'parcel',
      PRENOM: 'person',
      CELLULAIRE: 'person',
      Language: 'person',
      Locataire: 'person',
    });
    expect(groups).not.toHaveProperty('Package status');
    expect(groups).not.toHaveProperty('Notes');
  });

  it('starts every lot-number column per parcel, as the poutine sample names them too', () => {
    const columns = ['Designation', 'designation', 'NUM designation', 'ADRESSE'];
    expect(defaultColumnGroups(columns, detectRoles(columns))).toEqual({
      Designation: 'parcel',
      designation: 'parcel',
      'NUM designation': 'parcel',
      ADRESSE: 'person',
    });
  });
});

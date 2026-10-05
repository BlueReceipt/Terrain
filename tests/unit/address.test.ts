import { describe, expect, it } from 'vitest';
import {
  addressParts,
  findPostalCode,
  sameAddress,
  similarTown,
  streetKey,
  townKey,
} from '../../src/domain/address.ts';
import { compactKey, editDistance, fold } from '../../src/domain/text.ts';
import type { FieldRole } from '../../src/domain/types.ts';

const parts = (street: string, town: string, postalCode = '', province = '') => {
  const values: Partial<Record<FieldRole, string>> = { street, town, postalCode, province };
  return addressParts((role) => values[role] ?? '');
};

describe('text helpers', () => {
  it('fold strips accents, case, punctuation and non-breaking spaces', () => {
    expect(fold('Saint-Élie-de-Caxton')).toBe('saint elie de caxton');
    expect(fold('1 234 701')).toBe('1 234 701');
  });

  it('compactKey makes "1 234 567" and "1234567" one key', () => {
    expect(compactKey('1 234 567')).toBe(compactKey('1234567'));
    expect(compactKey('1 234 701')).toBe('1234701');
    expect(compactKey('\n1 236 621')).toBe('1236621');
  });

  it('editDistance gives up past the limit', () => {
    expect(editDistance('laprairie', 'lapriairie', 2)).toBe(1);
    expect(editDistance('lachute', 'val brillant', 2)).toBe(3);
  });
});

describe('address normalization (§6.1, Alex 2026-09-29)', () => {
  it('reads one address typed two ways as the same street', () => {
    expect(streetKey('123 rue St-Paul')).toBe(streetKey('123, rue Saint-Paul'));
    expect(streetKey('9, Ch. du Grand-Marais')).toBe('9 chemin du grand marais');
    expect(streetKey('45 boul. Laurier')).toBe(streetKey('45 bd Laurier'));
    expect(streetKey('12 rte 138')).toBe('12 route 138');
  });

  it('uses only the first line of ADRESSE', () => {
    expect(streetKey('201-1085 rue NOTRE-DAME\nChamplain, QC\nG0X 1C0')).toBe(
      '201 1085 rue notre dame',
    );
  });

  it('keeps civic and unit numbers', () => {
    expect(streetKey('800, rue Grenier, suite 2')).toBe('800 rue grenier suite 2');
    expect(streetKey('A-211 rue Hervé-Toupin')).not.toBe(streetKey('211 rue Hervé-Toupin'));
  });

  it('finds the postal code wherever the client put it, in every spelling', () => {
    expect(findPostalCode('Val-Brillant', 'Lachute QC J8H 3P1')).toBe('J8H3P1');
    expect(findPostalCode('J0 J 2K0')).toBe('J0J2K0');
    expect(findPostalCode('Shawinigan (Québec) G9P5L6')).toBe('G9P5L6');
    expect(findPostalCode('g5j 2g2')).toBe('G5J2G2');
    expect(findPostalCode('J7V -J6', 'Vaudreuil-Dorion')).toBeNull();
  });

  it('reads the town without province words or postal code; QC means Québec', () => {
    expect(townKey('Lachute QC J8H 3P1')).toBe('lachute');
    expect(townKey('Trois-Rivières (QC) G9A 5T3')).toBe('trois rivieres');
    expect(townKey('Saint-Constant, Qc, J5A 0N3')).toBe('saint constant');
    expect(townKey('St-Césaire')).toBe(townKey('Saint-Césaire'));
  });

  it('keeps Québec City as a town', () => {
    expect(townKey('Québec')).toBe('quebec');
  });

  it('tolerates a typo in a town name, not a different town', () => {
    expect(similarTown(townKey('Saint-Pierre-Baptistte'), townKey('Saint-Pierre-Baptiste'))).toBe(
      true,
    );
    expect(similarTown(townKey('Lachute'), townKey('Val-Brillant'))).toBe(false);
  });
});

describe('sameAddress', () => {
  it('matches the same street and postal code', () => {
    expect(
      sameAddress(
        parts('60, rue Sainte-Anne', 'Amqui', 'G5J 2G2'),
        parts('60 rue Ste-Anne', 'Amqui', 'G5J2G2'),
      ),
    ).toBe(true);
  });

  it('keeps the same street in two towns apart', () => {
    expect(
      sameAddress(
        parts('420, avenue Hamford', 'Saint-Isidore', 'J0L 2A0'),
        parts('420, avenue Hamford', 'Lachute QC J8H 3P1'),
      ),
    ).toBe(false);
  });

  it('uses the postal code found in MUNICIPALITE', () => {
    expect(
      sameAddress(
        parts('840, avenue Hamford', 'Lachute QC J8H 3P1', 'Val-Brillant'),
        parts('840 av. Hamford', 'Lachute', 'J8H 3P1'),
      ),
    ).toBe(true);
  });

  it('falls back to the town when a postal code is missing', () => {
    expect(
      sameAddress(
        parts('126, rue Saint-Marc', 'Saint-Pierre-Baptistte'),
        parts('126 rue St-Marc', 'Saint-Pierre-Baptiste', 'G0P 1K1'),
      ),
    ).toBe(true);
    expect(
      sameAddress(
        parts('126, rue Saint-Marc', 'Saint-Roch-des-Aulnaies'),
        parts('126 rue St-Marc', 'Saint-Pierre-Baptiste', 'G0P 1K1'),
      ),
    ).toBe(false);
  });

  it('never groups blank addresses', () => {
    expect(sameAddress(parts('', 'Forestville'), parts('', 'Forestville'))).toBe(false);
  });
});

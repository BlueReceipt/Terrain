import { editDistance, fold } from './text.ts';
import type { ColumnRoles } from './types.ts';

// Street and town abbreviations, with "ave" seen in Alex's files.
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  st: 'saint',
  ste: 'sainte',
  ch: 'chemin',
  rte: 'route',
  boul: 'boulevard',
  bd: 'boulevard',
  av: 'avenue',
  ave: 'avenue',
  rd: 'road',
};

// Alex, 2026-09-29: QC, Qc and (Québec) all mean the province.
const PROVINCE_WORDS = new Set(['qc', 'quebec', 'on', 'ont', 'ontario', 'canada']);

// Canadian postal codes, including the "J0 J 2K0" and "G9P5L6" spellings found in the client files.
const POSTAL_CODE = /\b([A-Z]\d)\s?([A-Z])\s?-?\s?(\d)\s?([A-Z]\d)\b/i;
const POSTAL_CODES = new RegExp(POSTAL_CODE.source, 'gi');

function expandAbbreviations(folded: string): string {
  return folded
    .split(' ')
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(' ');
}

/** The first postal code found in the texts, in order, as "G5J2G2". */
export function findPostalCode(...texts: string[]): string | null {
  for (const text of texts) {
    const match = POSTAL_CODE.exec(text);
    if (match)
      return `${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''}${match[4] ?? ''}`.toUpperCase();
  }
  return null;
}

/** ADRESSE's first line, normalized: "123, rue St-Paul" and "123 rue Saint-Paul" give the same key. */
export function streetKey(adresse: string): string {
  return expandAbbreviations(fold(adresse.split(/\r?\n/)[0] ?? ''));
}

/** MUNICIPALITE without postal code or province words ("Lachute QC J8H 3P1" → "lachute"). */
export function townKey(municipalite: string): string {
  const expanded = expandAbbreviations(fold(municipalite.replace(POSTAL_CODES, ' ')));
  const withoutProvince = expanded
    .split(' ')
    .filter((word) => !PROVINCE_WORDS.has(word))
    .join(' ');
  // "Québec" alone is Québec City, not a province word to drop.
  return withoutProvince || expanded;
}

export function similarTown(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 6 && editDistance(a, b, 2) <= 2;
}

export interface AddressParts {
  street: string;
  town: string;
  postalCode: string | null;
}

/** Reads the address columns, finding the postal code wherever the client put it. */
export function addressParts(field: (role: keyof ColumnRoles) => string): AddressParts {
  const street = field('street');
  const town = field('town');
  return {
    street: streetKey(street),
    town: townKey(town),
    postalCode: findPostalCode(field('postalCode'), town, street, field('province')),
  };
}

/**
 * Same house by address (Alex, 2026-09-29): the same street and the same postal code.
 * When either row has no postal code, the same street in the same town, typos tolerated.
 */
export function sameAddress(a: AddressParts, b: AddressParts): boolean {
  if (!a.street || a.street !== b.street) return false;
  if (a.postalCode && b.postalCode) return a.postalCode === b.postalCode;
  if (!a.town || !b.town) return true;
  return similarTown(a.town, b.town);
}

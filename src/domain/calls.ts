import { headerKey } from './columns.ts';
import { currentValue } from './identity.ts';
import type { ColumnRoles, Row } from './types.ts';

/** Call outcomes, in Alex's own words from the call results in his export (2026-10-01). */
export const DEFAULT_CALL_OUTCOMES: readonly string[] = [
  'Info good',
  'Info changed',
  'Voicemail',
  'No answer',
  'Wrong number',
];

/** A pending call survives the switch to the dialer for this long. */
export const PENDING_CALL_MINUTES = 30;

const TEN_DIGITS = /(?<!\d)(?:\+?1[\s.-]*)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?!\d)/g;
const SEVEN_DIGITS = /(?<!\d)(\d{3})[\s.-]?(\d{4})(?!\d)/g;

/** The phone numbers in a cell, as digits: "(450) 555-0123 poste 2" → ["4505550123"]. */
export function phoneNumbersIn(text: string): string[] {
  const full = [...text.matchAll(TEN_DIGITS)].map(
    (match) => `${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''}`,
  );
  if (full.length > 0) return [...new Set(full)];
  return [...new Set([...text.matchAll(SEVEN_DIGITS)].map((m) => `${m[1] ?? ''}${m[2] ?? ''}`))];
}

/** One number written two ways: "450 555-0100" = "(450) 555 0100" = "555-0100" without its area code. */
export function samePhone(a: string, b: string): boolean {
  const digitsA = a.replace(/\D/g, '');
  const digitsB = b.replace(/\D/g, '');
  const length = Math.min(digitsA.length, digitsB.length, 10);
  return length >= 7 && digitsA.slice(-length) === digitsB.slice(-length);
}

const PHONE_ROLES = ['homePhone', 'cellPhone', 'workPhone'] as const;
const PHONE_HEADER = /tel|cell|phone|mobile|contactnumber/;
const NOT_A_PHONE = /telecopieur|fax/;

/** Columns that hold phone numbers: the phone roles, and headers like "Contact number" or "Cellulaire 2". */
export function phoneColumns(columns: readonly string[], roles: ColumnRoles): string[] {
  const byRole = new Set<string | undefined>(PHONE_ROLES.map((role) => roles[role]));
  return columns.filter((column) => {
    if (byRole.has(column)) return true;
    const key = headerKey(column);
    return PHONE_HEADER.test(key) && !NOT_A_PHONE.test(key);
  });
}

/** A number at a house, for the number chooser: who it reaches and how the file names it. */
export interface HouseNumber {
  /** The number as the file writes it. */
  display: string;
  /** Its digits, for the dialer. */
  digits: string;
  /** 'home' (the home line, shared), 'cell', 'work', or another phone column's header. */
  kind: string;
  /** The owners it reaches, in file order; empty for the home line, which reaches the house. */
  owners: string[];
  rowIds: string[];
}

/**
 * Every number at a house, each once, in file order: "Marie Trempette, cell
 * 514-555-0199", "Home, 450-555-0100". A number several rows list reaches all of them.
 */
export function houseNumbers(
  rows: readonly Row[],
  columns: readonly string[],
  roles: ColumnRoles,
  ownerOf: (row: Row) => string,
): HouseNumber[] {
  const kindOf = (column: string) =>
    column === roles.homePhone
      ? 'home'
      : column === roles.cellPhone
        ? 'cell'
        : column === roles.workPhone
          ? 'work'
          : column;
  const numbers: HouseNumber[] = [];
  for (const row of rows) {
    for (const column of phoneColumns(columns, roles)) {
      const text = currentValue(row, column);
      for (const digits of phoneNumbersIn(text)) {
        const known = numbers.find((number) => samePhone(number.digits, digits));
        if (known) {
          if (!known.rowIds.includes(row.rowId)) known.rowIds.push(row.rowId);
          const owner = ownerOf(row);
          if (known.kind !== 'home' && !known.owners.includes(owner)) known.owners.push(owner);
          continue;
        }
        const kind = kindOf(column);
        numbers.push({
          display:
            text
              .split(/[/,;\n]/)
              .find((part) => phoneNumbersIn(part).includes(digits))
              ?.trim() ?? digits,
          digits,
          kind,
          owners: kind === 'home' ? [] : [ownerOf(row)],
          rowIds: [row.rowId],
        });
      }
    }
  }
  return numbers;
}

/** Rows that list a number: the home line reaches every row sharing it, a cell its owner's row. */
export function rowsListingNumber(
  rows: readonly Row[],
  number: string,
  columns: readonly string[],
): Row[] {
  return rows.filter((row) =>
    columns.some((column) =>
      phoneNumbersIn(currentValue(row, column)).some((listed) => samePhone(listed, number)),
    ),
  );
}

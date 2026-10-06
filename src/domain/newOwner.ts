import { headerKey } from './columns.ts';
import { currentReader, currentValue, displayName } from './identity.ts';
import type { ColumnRoles, Row } from './types.ts';

/**
 * A new owner at the door (Alex, 2026-10-06): in Edit info, New owner clears the owner's name and
 * how to reach them for the new owner's, and what they held goes to this column, which Terrain adds
 * to the campaign the first time. Fixes of a bad number or address don't go there: the Journal keeps them.
 */
export const PREVIOUS_INFO = 'Previous info';

/** The campaign's Previous info column: one of its own by that name, else Terrain's. */
export function previousInfoColumn(columnOrder: readonly string[]): string {
  const key = headerKey(PREVIOUS_INFO);
  return columnOrder.find((column) => headerKey(column) === key) ?? PREVIOUS_INFO;
}

export function isPreviousInfoColumn(column: string): boolean {
  return headerKey(column) === headerKey(PREVIOUS_INFO);
}

// Phones, fax and email. Contact person and Contact number are the renter's, not the owner's.
const REACH = /tel|cell|phone|mobile|fax|courriel|email/;

/** The columns a new owner replaces: the owner's name, phones and email, in file order. */
export function ownerColumns(columnOrder: readonly string[], roles: ColumnRoles): string[] {
  const names = new Set([roles.salutation, roles.firstName, roles.lastName, roles.company]);
  return columnOrder.filter((column) => {
    const key = headerKey(column);
    if (key.includes('contact')) return false;
    return names.has(column) || column === roles.email || REACH.test(key);
  });
}

/** "Marie Trempette, 450 555-0100": the row's owner and numbers in those columns, as they are now. */
export function ownerDetails(row: Row, columns: readonly string[], roles: ColumnRoles): string {
  const names = new Set([roles.salutation, roles.firstName, roles.lastName, roles.company]);
  const reach = columns
    .filter((column) => !names.has(column))
    .map((column) => currentValue(row, column).trim());
  return [displayName(currentReader(row, roles)), ...reach].filter(Boolean).join(', ');
}

/** Previous info with one more owner: each on a line of its own, oldest first. */
export function withPreviousOwner(existing: string, entry: string): string {
  return existing.trim() ? `${existing.trim()}\n${entry}` : entry;
}

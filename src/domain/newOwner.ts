import { headerKey } from './columns.ts';
import { fileDate, formatTime, isTerrainTime } from './format.ts';
import { currentReader, currentValue, displayName, type FieldReader } from './identity.ts';
import { startStatus } from './statuses.ts';
import { editDistance, fold } from './text.ts';
import type { ColumnRoles, Row, Status } from './types.ts';

/**
 * A new owner (Alex, 2026-10-06), met at the door or named by the client's file: the owner before
 * goes to this column, which Terrain adds to the campaign the first time. At the door, New owner in
 * Edit info clears the owner's name and how to reach them for the new owner's. Fixes of a bad number
 * or address don't go there: the Journal keeps them.
 */
export const PREVIOUS_INFO = 'Previous info';

/** The words Previous info is written in, from src/ui/strings.ts. */
export interface PreviousInfoWords {
  /** "Marie Trempette, 450 555-0100 (until 26.09.2026)" */
  previousOwner: (details: string, until: string) => string;
  /** "Given 26.09.2026": the visit the owner before had. */
  visit: (status: string, date: string) => string;
}

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

/** "Given 26.09.2026": the row's visit, for Previous info; nothing at the start status. */
export function previousVisit(
  row: Pick<Row, 'statusId' | 'visitDate'>,
  statuses: readonly Status[],
  words: PreviousInfoWords,
  format: string,
): string {
  const status = statuses.find((candidate) => candidate.id === row.statusId);
  if (!status || status.id === startStatus(statuses).id) return '';
  const [datePart = format] = format.split(' ');
  return words.visit(status.label, formatTime(row.visitDate, datePart));
}

/**
 * Whether a row's visit is the owner before's when the owner changes at the door (Alex,
 * 2026-10-06): a visit made today is the new owner's; an older one, or a status without a visit,
 * goes to Previous info, and the row starts over.
 */
export function visitWasBefore(
  row: Pick<Row, 'statusId' | 'visitDate'>,
  statuses: readonly Status[],
  today: string,
): boolean {
  if (isTerrainTime(row.visitDate) && fileDate(row.visitDate) === today) return false;
  return row.statusId !== startStatus(statuses).id || row.visitDate !== '';
}

/** Two names differ beyond a one-letter slip. */
function differ(a: string, b: string): boolean {
  return editDistance(a, b, 1) > 1;
}

/**
 * Whether the client's file names someone else than the owner Terrain has (Alex, 2026-10-06): a
 * different first name and a different last name. Only the last name changes when someone remarries
 * or takes back a maiden name. Without a first name, the last name decides; a company is someone
 * else under another name, and so is a person in a company's place. Filling in an owner where there
 * was none, or a file naming no one, is no new owner.
 */
export function isNewOwner(before: FieldReader, after: FieldReader): boolean {
  const named = (read: FieldReader) => ({
    first: fold(read('firstName')),
    last: fold(read('lastName')),
    company: fold(read('company')),
  });
  const was = named(before);
  const now = named(after);
  const nobody = (owner: typeof was) => !owner.first && !owner.last && !owner.company;
  if (nobody(was) || nobody(now)) return false;
  const person = (owner: typeof was) => Boolean(owner.first || owner.last);
  if (person(was) !== person(now)) return true;
  if (!person(now)) return differ(was.company, now.company);
  if (!differ(was.last, now.last)) return false;
  return !was.first || !now.first || differ(was.first, now.first);
}

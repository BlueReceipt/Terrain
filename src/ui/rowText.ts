import { currentReader, currentValue, displayName } from '../domain/identity.ts';
import type { ColumnRoles, Row } from '../domain/types.ts';
import { strings } from './strings.ts';

/** A house's address: the first line of its first row's ADRESSE that has one. */
export function addressOf(rows: readonly Row[], roles: ColumnRoles): string {
  for (const row of rows) {
    const street = (currentValue(row, roles.street).split(/\r?\n/)[0] ?? '').trim();
    if (street) return street;
  }
  return strings.card.noAddress;
}

/** A row's owner as the card names it: PRENOM NOM, the company, APPEL, or "No name". */
export function nameOf(row: Row, roles: ColumnRoles): string {
  return displayName(currentReader(row, roles)) || strings.noName;
}

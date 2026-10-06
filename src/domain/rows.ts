import {
  fingerprintOf,
  groupHouses,
  identityInputs,
  lotKeysForRow,
  readerFor,
  type House,
} from './identity.ts';
import { startStatus, statusForPackageText } from './statuses.ts';
import type { AppRole, Campaign, ColumnRoles, IncomingRow, Row, Status } from './types.ts';

export interface RowContext {
  campaignId: string;
  roles: ColumnRoles;
  statuses: readonly Status[];
  colorMap: Readonly<Record<string, string>>;
  now: string;
}

export function appValue(
  fields: Readonly<Record<string, string>>,
  roles: ColumnRoles,
  role: AppRole,
): string {
  const column = roles[role];
  return column === undefined ? '' : (fields[column] ?? '');
}

/** A My Maps pin's color decides its status; a spreadsheet row falls back to its Package status text. */
export function statusIdFor(
  incoming: Pick<IncomingRow, 'pinColor' | 'fields'>,
  context: Pick<RowContext, 'roles' | 'statuses' | 'colorMap'>,
): string {
  const known = new Set(context.statuses.map((status) => status.id));
  if (incoming.pinColor !== null) {
    const mapped = context.colorMap[incoming.pinColor];
    return mapped !== undefined && known.has(mapped) ? mapped : startStatus(context.statuses).id;
  }
  const text = appValue(incoming.fields, context.roles, 'packageStatus');
  return statusForPackageText(text, context.statuses)?.id ?? startStatus(context.statuses).id;
}

export function incomingAppFields(
  incoming: Pick<IncomingRow, 'fields'>,
  roles: ColumnRoles,
): Pick<Row, 'packageStatusText' | 'visitDate' | 'callDate' | 'callResult' | 'importedNotes'> {
  return {
    packageStatusText: appValue(incoming.fields, roles, 'packageStatus'),
    visitDate: appValue(incoming.fields, roles, 'visitDate'),
    callDate: appValue(incoming.fields, roles, 'callDate'),
    callResult: appValue(incoming.fields, roles, 'callResult'),
    importedNotes: appValue(incoming.fields, roles, 'notes'),
  };
}

export function createRow(
  incoming: IncomingRow,
  rowId: string,
  rowIndex: number,
  context: RowContext,
): Row {
  const statusId = statusIdFor(incoming, context);
  return {
    rowId,
    campaignId: context.campaignId,
    rowIndex,
    layer: incoming.layer,
    parcelIdRaw: incoming.parcelIdRaw,
    oldParcelIds: [],
    lotKeys: [],
    houseKey: '',
    fingerprint: fingerprintOf(incoming.parcelIdRaw, readerFor(incoming.fields, context.roles)),
    sourceFields: { ...incoming.fields },
    edits: {},
    importedPosition: incoming.position,
    position: incoming.position,
    placed: null,
    addressText: incoming.addressText,
    pinColor: incoming.pinColor,
    statusId,
    importedStatusId: statusId,
    ...incomingAppFields(incoming, context.roles),
    origin: null,
    touched: { appFields: [], moved: false },
    missingFromLastImport: false,
    updatedAt: context.now,
  };
}

/** Recomputes lot keys and house keys from current values; run after every import and correction. */
export function applyIdentity(
  rows: readonly Row[],
  campaign: Pick<Campaign, 'roles' | 'lotColumn'>,
): { rows: Row[]; houses: House[] } {
  const withLots = rows.map((row) => ({ ...row, lotKeys: lotKeysForRow(row, campaign.lotColumn) }));
  const houses = groupHouses(identityInputs(withLots, campaign.roles));
  const houseOf = new Map<string, string>();
  for (const house of houses) for (const rowId of house.rowIds) houseOf.set(rowId, house.houseKey);
  return {
    rows: withLots.map((row) => ({ ...row, houseKey: houseOf.get(row.rowId) ?? `h:${row.rowId}` })),
    houses,
  };
}

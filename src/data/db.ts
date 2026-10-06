import { Dexie, type EntityTable, type Transaction } from 'dexie';
import { DEFAULT_CALL_OUTCOMES } from '../domain/calls.ts';
import { headerKey } from '../domain/columns.ts';
import type { ImportEvent, TerrainEvent } from '../domain/events.ts';
import { DEFAULT_DATE_FORMAT, type DateFormat } from '../domain/format.ts';
import { lotKeysForRow, lotNumberColumns } from '../domain/identity.ts';
import type { NotesExportMode } from '../domain/notes.ts';
import { DEFAULT_STATUSES } from '../domain/statuses.ts';
import type { Campaign, Row, Status } from '../domain/types.ts';

export type { ImportEvent, TerrainEvent };

/** An event as stored: `seq` orders a campaign's events, the order they are replayed and undone in. */
export type StoredEvent = TerrainEvent & { seq: number };

/** A number Alex dialed from Terrain, waiting for its outcome. */
export interface PendingCall {
  id: string;
  campaignId: string;
  houseKey: string;
  number: string;
  /** The rows at the house listing the number when it was dialed. */
  rowIds: string[];
  startedAt: string;
}

/** The offline map Alex loaded. Metadata only: the file itself lives in OPFS. */
export interface BasemapInfo {
  id: 'current';
  /** The file name Alex picked. */
  name: string;
  size: number;
  minZoom: number;
  maxZoom: number;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  loadedAt: string;
}

export interface Settings {
  key: 'app';
  statuses: Status[];
  callOutcomes: string[];
  /** Dates Terrain writes (Alex, 2026-10-01: 26.09.2026 14:32). */
  dateFormat: DateFormat;
  notesExportMode: NotesExportMode;
  /** Rows closed from the lot get Visit date (2026-10-01: yes). */
  fillVisitDateViaLot: boolean;
  lastCampaignId: string | null;
  /** Result of navigator.storage.persist(), asked after the first import. */
  storagePersisted: boolean | null;
  /**
   * Houses without coordinates are found from their address at import (Alex, 2026-10-05): only the
   * street, town, postal code and province go online, to Adresses Québec. Where Terrain has a relay.
   */
  lookUpAddresses: boolean;
  /** The background map from the internet while online, where Terrain has a relay (2026-10-05). */
  onlineMap: boolean;
  /** The screens' language (Alex, 2026-10-06); null, or absent before, follows the phone. */
  language?: 'en' | 'fr' | null;
}

export function defaultSettings(): Settings {
  return {
    key: 'app',
    statuses: [...DEFAULT_STATUSES],
    callOutcomes: [...DEFAULT_CALL_OUTCOMES],
    dateFormat: DEFAULT_DATE_FORMAT,
    notesExportMode: 'joined',
    fillVisitDateViaLot: true,
    lastCampaignId: null,
    storagePersisted: null,
    lookUpAddresses: true,
    onlineMap: true,
  };
}

/** Statuses saved by an earlier version, given the fields and statuses this version adds. */
export function upgradeStatuses(saved: readonly Partial<Status>[]): Status[] {
  const statuses: Status[] = saved.map((status) => {
    const known = DEFAULT_STATUSES.find((fallback) => fallback.id === status.id);
    return {
      ...(known ?? DEFAULT_STATUSES[0]),
      ...status,
      notesLot: status.notesLot ?? known?.notesLot ?? false,
      onRail: status.onRail ?? known?.onRail ?? !status.isStartStatus,
    } as Status;
  });
  for (const fallback of DEFAULT_STATUSES) {
    if (!statuses.some((status) => status.id === fallback.id)) statuses.push({ ...fallback });
  }
  return statuses;
}

/** The current schema version; a backup records it. */
export const SCHEMA_VERSION = 6;

/**
 * Version 5 → 6 (Alex, 2026-10-06): rows at different addresses are linked as co-owners of one plot
 * when they share the parcel ID and the lot number, so every row's links are worked out again.
 * Used by the upgrade and on older backups.
 */
export function withLotLinks(rows: readonly Row[], campaigns: readonly Campaign[]): Row[] {
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  return rows.map((row) => {
    const campaign = byId.get(row.campaignId);
    if (!campaign) return row;
    const lotKeys = lotKeysForRow(row, campaign.lotColumn, lotNumberColumns(campaign.columnOrder));
    return { ...row, lotKeys };
  });
}

/**
 * Version 4 → 5 (Alex, 2026-10-05): every position so far came from the file, and both online
 * switches start on. Used by the upgrade and on older backups.
 */
export function withPlacement(row: Row): Row {
  return { ...row, placed: (row as Partial<Row>).placed ?? null };
}

export function withOnlineSwitches(saved: Settings): Settings {
  const partial = saved as Partial<Settings>;
  return {
    ...saved,
    lookUpAddresses: partial.lookUpAddresses ?? true,
    onlineMap: partial.onlineMap ?? true,
  };
}

// Version 2 set these columns as house fields, the town and postal code among them.
const FORMER_HOUSE_COLUMNS = new Set([
  'adresse',
  'municipalite',
  'province',
  'codepostal',
  'telres',
]);

/**
 * Version 2 → 3 (Alex, 2026-10-01): a fix goes on one owner only, so the address and phone columns
 * Terrain had put with the house become person fields. Used by the upgrade and on older backups.
 */
export function withOwnerFields(campaign: Campaign): Campaign {
  const columnGroups = { ...campaign.columnGroups };
  for (const [column, group] of Object.entries(columnGroups)) {
    if (group === 'house' && FORMER_HOUSE_COLUMNS.has(headerKey(column)))
      columnGroups[column] = 'person';
  }
  return { ...campaign, columnGroups };
}

/** Version 1 → 2: event order, absorbed corrections, imported statuses, new settings. */
async function upgradeToVersion2(tx: Transaction): Promise<void> {
  // Version 1 stored only import events, at most one per second per campaign: their time orders them.
  const events = (await tx.table('events').toArray()) as (ImportEvent & { seq?: number })[];
  events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const lastSeq = new Map<string, number>();
  for (const event of events) {
    const seq = (lastSeq.get(event.campaignId) ?? 0) + 1;
    lastSeq.set(event.campaignId, seq);
    event.seq = seq;
    event.payload.absorbed = (event.payload as Partial<ImportEvent['payload']>).absorbed ?? [];
  }
  await tx.table('events').bulkPut(events);

  // Version 1 had no local events, so every status was the one the import gave.
  await tx
    .table('rows')
    .toCollection()
    .modify((row: Row) => {
      row.importedStatusId = (row as Partial<Row>).importedStatusId ?? row.statusId;
      row.touched = {
        appFields: row.touched.appFields.filter((field) => (field as string) !== 'notes').sort(),
        moved: row.touched.moved,
      };
    });

  await tx
    .table('settings')
    .toCollection()
    .modify((saved: Partial<Settings> & { key: 'app' }) => {
      const fresh = defaultSettings();
      saved.statuses = upgradeStatuses(saved.statuses ?? fresh.statuses);
      saved.callOutcomes ??= fresh.callOutcomes;
      saved.dateFormat ??= fresh.dateFormat;
      saved.notesExportMode ??= fresh.notesExportMode;
      saved.fillVisitDateViaLot ??= fresh.fillVisitDateViaLot;
    });
}

export class TerrainDb extends Dexie {
  declare campaigns: EntityTable<Campaign, 'id'>;
  declare rows: EntityTable<Row, 'rowId'>;
  declare events: EntityTable<StoredEvent, 'id'>;
  declare settings: EntityTable<Settings, 'key'>;
  declare pendingCalls: EntityTable<PendingCall, 'id'>;
  declare basemaps: EntityTable<BasemapInfo, 'id'>;

  constructor(name = 'terrain') {
    super(name);
    this.version(1).stores({
      campaigns: 'id',
      rows: 'rowId, campaignId, [campaignId+houseKey]',
      events: 'id, campaignId, *rowIds, type, at',
      settings: 'key',
    });
    this.version(2)
      .stores({
        rows: 'rowId, campaignId, [campaignId+houseKey], *lotKeys',
        events: 'id, campaignId, *rowIds, type, at, [campaignId+seq]',
        pendingCalls: 'id, campaignId',
      })
      .upgrade(upgradeToVersion2);
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        const campaigns = (await tx.table('campaigns').toArray()) as Campaign[];
        await tx.table('campaigns').bulkPut(campaigns.map(withOwnerFields));
      });
    // Version 4: the offline map's metadata. Backups leave it out: the map file stays on the phone.
    this.version(4).stores({ basemaps: 'id' });
    this.version(5)
      .stores({})
      .upgrade(async (tx) => {
        const rows = (await tx.table('rows').toArray()) as Row[];
        await tx.table('rows').bulkPut(rows.map(withPlacement));
        const settings = (await tx.table('settings').toArray()) as Settings[];
        await tx.table('settings').bulkPut(settings.map(withOnlineSwitches));
      });
    this.version(6)
      .stores({})
      .upgrade(async (tx) => {
        const campaigns = (await tx.table('campaigns').toArray()) as Campaign[];
        const rows = (await tx.table('rows').toArray()) as Row[];
        await tx.table('rows').bulkPut(withLotLinks(rows, campaigns));
      });
  }
}

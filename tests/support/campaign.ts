import { randomUUID } from 'node:crypto';
import { TerrainDb } from '../../src/data/db.ts';
import { commitImport, loadCampaign } from '../../src/data/repo.ts';
import { detectRoles } from '../../src/domain/columns.ts';
import type { ImportPlan } from '../../src/domain/importPlan.ts';
import type { ParsedFile, Row } from '../../src/domain/types.ts';
import { COLUMNS } from '../../scripts/make-fixtures.ts';
import { importInto, NOW, parseFixture } from './import.ts';

/** A database of its own in fake IndexedDB (the test file imports 'fake-indexeddb/auto'). */
export function freshDb(): TerrainDb {
  return new TerrainDb(`terrain-test-${randomUUID()}`);
}

/** The cases fixture saved as a campaign: at 123 rue Saint-Paul, Alain and Marie on P1-216B and Alain on P1-217A; Luc on P1-216B at 12 chemin du Lac. */
export async function casesCampaign(db: TerrainDb): Promise<ImportPlan> {
  const plan = importInto(parseFixture('public/cases.kmz'));
  await commitImport(db, plan, 'import-1', NOW);
  return plan;
}

export async function storedRows(db: TerrainDb, campaignId: string): Promise<Row[]> {
  return (await loadCampaign(db, campaignId))?.rows ?? [];
}

/** The row of a parcel ID cell whose owner has this first name. */
export function rowOf(rows: readonly Row[], parcelIdRaw: string, firstName: string): Row {
  const row = rows.find(
    (candidate) =>
      candidate.parcelIdRaw === parcelIdRaw && candidate.sourceFields.PRENOM === firstName,
  );
  if (!row) throw new Error(`No row ${parcelIdRaw} ${firstName}`);
  return row;
}

/** The row whose owner is this company (Propriétaire) or this "PRENOM NOM". */
export function rowOfOwner(rows: readonly Row[], owner: string): Row {
  const row = rows.find(
    (candidate) =>
      candidate.sourceFields.Propriétaire === owner ||
      `${candidate.sourceFields.PRENOM ?? ''} ${candidate.sourceFields.NOM ?? ''}` === owner,
  );
  if (!row) throw new Error(`No row of ${owner}`);
  return row;
}

/**
 * Alex's example of two co-owners on one parcel (2026-10-01), played by two poutine places from
 * fixtures/public/restaurants.json (OpenStreetMap), at the cantine's address. Example data comes
 * from that list, never from names in Alex's own files or messages.
 */
export const CO_OWNERS: readonly MiniRow[] = [
  {
    parcel: 'P1-300',
    company: 'Cantine la patate a Patou',
    address: '170 2e Rang',
    town: 'Saint-Louis-de-Blandford',
    postal: 'G0Z 1B0',
    home: '819 555-0140',
    cell: '819 555-0141',
  },
  {
    parcel: 'P1-300',
    company: 'La Poutinerie',
    address: '170 2e Rang',
    town: 'Saint-Louis-de-Blandford',
    postal: 'G0Z 1B0',
    home: '819 555-0140',
    cell: '418 555-0142',
  },
];

export function houseOf(rows: readonly Row[], row: Row): Row[] {
  return rows.filter((candidate) => candidate.houseKey === row.houseKey);
}

/** Replaces rows by the changed ones, by rowId. */
export function withChanged(rows: readonly Row[], changed: readonly Row[]): Row[] {
  const byId = new Map(changed.map((row) => [row.rowId, row]));
  return rows.map((row) => byId.get(row.rowId) ?? row);
}

export interface MiniRow {
  parcel: string;
  first?: string;
  last?: string;
  appel?: string;
  company?: string;
  address?: string;
  town?: string;
  postal?: string;
  numLot?: string;
  home?: string;
  cell?: string;
  notes?: string;
  color?: string;
}

/** A small campaign of hand-made rows, each about a kilometer from the others. */
export function miniCampaign(rows: readonly MiniRow[]): ImportPlan {
  const blank = Object.fromEntries(COLUMNS.map((column) => [column, '']));
  const parsed: ParsedFile = {
    fileName: 'mini.kmz',
    format: 'kml',
    columns: [...COLUMNS],
    layers: ['Layer'],
    rows: rows.map((row, i) => ({
      sourceIndex: i,
      layer: 'Layer',
      parcelIdRaw: row.parcel,
      fields: {
        ...blank,
        PRENOM: row.first ?? '',
        NOM: row.last ?? '',
        APPEL: row.appel ?? '',
        Propriétaire: row.company ?? '',
        ADRESSE: row.address ?? '',
        MUNICIPALITE: row.town ?? (row.address ? 'Saint-Roch-des-Aulnaies' : ''),
        CODE_POSTAL: row.postal ?? '',
        NUM_LOT: row.numLot ?? '',
        TEL_RES: row.home ?? '',
        CELLULAIRE: row.cell ?? '',
        Notes: row.notes ?? '',
      },
      position: { lat: 45.2 + i * 0.01, lng: -73.6 },
      addressText: null,
      pinColor: row.color ?? '#0288D1',
    })),
    reference: [],
    roles: detectRoles(COLUMNS),
  };
  return importInto(parsed);
}

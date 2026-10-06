import { describe, expect, it } from 'vitest';
import { planStatusChange } from '../../src/domain/lots.ts';
import { DEFAULT_STATUSES } from '../../src/domain/statuses.ts';
import type { Row } from '../../src/domain/types.ts';
import { houseOf, miniCampaign, rowOf, rowOfOwner, withChanged } from '../support/campaign.ts';
import { importInto, NOW, parseFixture } from '../support/import.ts';

const LATER = '2026-09-27T09:15:00-04:00';
const plan = importInto(parseFixture('public/cases.kmz'));
const roles = plan.campaign.roles;
const start = plan.merge.rows;

function tap(
  rows: readonly Row[],
  targets: readonly Row[],
  statusId: string,
  options: { now?: string; eventId?: string; target?: 'house' | 'row'; fill?: boolean } = {},
) {
  const houseKey = targets[0]?.houseKey ?? '';
  return planStatusChange({
    eventId: options.eventId ?? 'tap-1',
    campaignId: plan.campaign.id,
    now: options.now ?? NOW,
    houseKey,
    target: options.target ?? 'house',
    targetRows: targets,
    lotRowsElsewhere: rows.filter((row) => row.houseKey !== houseKey),
    statuses: DEFAULT_STATUSES,
    statusId,
    roles,
    fillVisitDateViaLot: options.fill ?? true,
  });
}

const alain = rowOf(start, 'P1-216B', 'Alain');
const marie = rowOf(start, 'P1-216B', 'Marie');
const alain217 = rowOf(start, 'P1-217A', 'Alain');
const luc = rowOf(start, 'P1-216B', 'Luc');
const trempette = houseOf(start, alain);

/** Luc's row with another status, as if marked earlier. */
function lucAt(statusId: string): Row[] {
  return start.map((row) => (row.rowId === luc.rowId ? { ...row, statusId } : row));
}

const byId = (rows: readonly Row[], id: string) => rows.find((row) => row.rowId === id);

describe('planStatusChange', () => {
  it('marks every row at the house with the status, its Package status text and Visit date', () => {
    expect(trempette.map((row) => row.rowId)).toEqual([alain.rowId, marie.rowId, alain217.rowId]);
    const planned = tap(start, trempette, 'at-door');
    for (const id of [alain.rowId, marie.rowId, alain217.rowId]) {
      expect(byId(planned?.rows ?? [], id)).toMatchObject({
        statusId: 'at-door',
        packageStatusText: 'At door',
        visitDate: NOW,
        origin: null,
      });
    }
    expect(planned?.event.payload.writtenRowIds).toHaveLength(3);
  });

  it('marks only the row on its own rail ("This row only")', () => {
    const planned = tap(start, [marie], 'to-research', { target: 'row' });
    expect(planned?.rows.map((row) => row.rowId)).toEqual([marie.rowId]);
    expect(planned?.event.payload.target).toBe('row');
    expect(planned?.rows[0]).toMatchObject({ statusId: 'to-research', visitDate: NOW });
  });

  it('changes only Package status and Visit date on the target rows: every other cell is identical', () => {
    // The status itself and the bookkeeping of what Alex touched change too; no cell does.
    const TAP_STATE = new Set([
      'statusId',
      'packageStatusText',
      'visitDate',
      'touched',
      'updatedAt',
    ]);
    const rest = (row: Row) =>
      JSON.stringify(Object.entries(row).filter(([key]) => !TAP_STATE.has(key)));
    const planned = tap(start, trempette, 'given');
    for (const before of trempette) {
      const after = byId(planned?.rows ?? [], before.rowId);
      expect(after).toMatchObject({ packageStatusText: 'Given', visitDate: NOW });
      expect(after && rest(after)).toBe(rest(before));
    }
  });

  it.each(['to-visit', 'at-door', 'skipped'])(
    'Given closes a co-owner row that is %s at another address',
    (status) => {
      const rows = lucAt(status);
      const planned = tap(rows, houseOf(rows, alain), 'given');
      expect(planned?.event.payload.lotAffected).toEqual([
        { rowId: luc.rowId, statusChanged: true },
      ]);
      expect(byId(planned?.rows ?? [], luc.rowId)).toMatchObject({
        statusId: 'given',
        packageStatusText: 'Given',
        visitDate: NOW,
        origin: { eventId: 'tap-1', fromHouseKey: alain.houseKey },
      });
    },
  );

  it.each(['given', 'to-research', 'not-given'])(
    'Given keeps a co-owner row that is %s at another address, and only notes it',
    (status) => {
      const rows = lucAt(status);
      const planned = tap(rows, houseOf(rows, alain), 'given');
      expect(planned?.event.payload.lotAffected).toEqual([
        { rowId: luc.rowId, statusChanged: false },
      ]);
      expect(planned?.event.payload.lot).toMatchObject({ mode: 'spread' });
      expect(byId(planned?.rows ?? [], luc.rowId)).toBeUndefined();
    },
  );

  it('leaves Visit date alone on rows closed from the lot when the setting is off', () => {
    const planned = tap(start, trempette, 'given', { fill: false });
    expect(byId(planned?.rows ?? [], luc.rowId)).toMatchObject({
      statusId: 'given',
      visitDate: luc.visitDate,
    });
  });

  it.each(['at-door', 'skipped', 'not-given'])(
    '%s at the house touches nothing elsewhere',
    (status) => {
      const planned = tap(start, trempette, status);
      expect(planned?.event.payload.lotAffected).toEqual([]);
      expect(planned?.event.payload.lot).toBeNull();
      expect(byId(planned?.rows ?? [], luc.rowId)).toBeUndefined();
    },
  );

  it('To research notes the co-owners at other addresses without changing them (Alex, 2026-10-01)', () => {
    const planned = tap(start, houseOf(start, luc), 'to-research');
    expect(planned?.event.payload.lot).toMatchObject({
      mode: 'note',
      statusLabel: 'To research',
      names: ['Luc Trempette'],
      address: '12, chemin du Lac',
    });
    expect(planned?.event.payload.lotAffected).toEqual([
      { rowId: alain.rowId, statusChanged: false },
      { rowId: marie.rowId, statusChanged: false },
    ]);
    expect(planned?.rows.map((row) => row.rowId)).toEqual([luc.rowId]);
  });

  it('never notes the target rows themselves', () => {
    const planned = tap(start, trempette, 'given');
    const noted = new Set(planned?.event.payload.lotAffected.map((affected) => affected.rowId));
    for (const row of trempette) expect(noted.has(row.rowId)).toBe(false);
  });

  it('records who and where at the tap: every owner at the house, in file order, once', () => {
    const planned = tap(start, trempette, 'given');
    expect(planned?.event.payload.lot).toEqual({
      mode: 'spread',
      statusLabel: 'Given',
      names: ['Alain Trempette', 'Marie Trempette'],
      address: '123, rue Saint-Paul',
      parcelId: 'P1-216B',
    });
  });

  it('turns a status that came from the lot into a direct visit when tapped again', () => {
    const first = tap(start, trempette, 'given');
    const rows = withChanged(start, first?.rows ?? []);
    const lucHouse = houseOf(rows, luc);
    const again = tap(rows, lucHouse, 'given', { now: LATER, eventId: 'tap-2' });
    expect(again?.event.payload.writtenRowIds).toEqual([luc.rowId]);
    expect(byId(again?.rows ?? [], luc.rowId)).toMatchObject({
      statusId: 'given',
      visitDate: LATER,
      origin: null,
    });
    // The lot is reached again from Luc's house: Alain and Marie keep Given and get Luc's note.
    expect(again?.event.payload.lotAffected).toEqual([
      { rowId: alain.rowId, statusChanged: false },
      { rowId: marie.rowId, statusChanged: false },
    ]);
    expect(again?.event.payload.lot?.names).toEqual(['Luc Trempette']);
  });

  it('does nothing when every row already has the status directly', () => {
    const first = tap(start, trempette, 'given');
    const rows = withChanged(start, first?.rows ?? []);
    expect(tap(rows, houseOf(rows, alain), 'given', { eventId: 'tap-2' })).toBeNull();
  });

  it('re-stamps Visit date when a different status replaces the one at the house', () => {
    const first = tap(start, trempette, 'at-door');
    const rows = withChanged(start, first?.rows ?? []);
    const second = tap(rows, houseOf(rows, alain), 'given', { now: LATER, eventId: 'tap-2' });
    expect(second?.rows.filter((row) => row.visitDate === LATER)).toHaveLength(4);
  });

  it('Mark as to visit reopens the rows and keeps the last Visit date', () => {
    const first = tap(start, trempette, 'given');
    const rows = withChanged(start, first?.rows ?? []);
    const reopened = tap(rows, houseOf(rows, alain), 'to-visit', {
      now: LATER,
      eventId: 'tap-2',
    });
    expect(reopened?.event.payload.stampsVisitDate).toBe(false);
    for (const row of reopened?.rows ?? []) {
      expect(row).toMatchObject({
        statusId: 'to-visit',
        packageStatusText: '',
        visitDate: NOW,
        origin: null,
      });
    }
    expect(reopened?.event.payload.lot).toBeNull();
  });

  it('spreads from a several-ID cell to each of its parcels, but not through an ID marked old', () => {
    // Owners from the list of poutine places (fixtures/public/restaurants.json).
    const mini = miniCampaign([
      {
        parcel: 'PT7-012/011',
        company: 'Casse-Croûte Chez Line',
        address: '420 Route 204',
        town: 'Saint-Aubert',
      },
      { parcel: 'PT7-012', company: 'Jos Patate', address: '21 Rue Maple', town: 'Grenville' },
      {
        parcel: 'PT7-011',
        company: 'Casse-croûte chez Jojo',
        address: "536 Route de l'Église",
        town: 'Saint-Pierre-Baptiste',
      },
      {
        parcel: 'PT7-010',
        company: 'Patate Boyer',
        address: '765 Rue Notre-Dame',
        town: 'Saint-Roch-des-Aulnaies',
      },
    ]);
    const rows = mini.merge.rows;
    const line = rowOfOwner(rows, 'Casse-Croûte Chez Line');
    expect(line.lotKeys).toEqual(['PT7-012|', 'PT7-011|']);
    const planned = tap(rows, [line], 'given', { target: 'row' });
    expect(planned?.event.payload.lotAffected).toEqual([
      { rowId: rowOfOwner(rows, 'Jos Patate').rowId, statusChanged: true },
      { rowId: rowOfOwner(rows, 'Casse-croûte chez Jojo').rowId, statusChanged: true },
    ]);

    const crossedOut = { ...line, oldParcelIds: ['PT7-011'], lotKeys: ['PT7-012|'] };
    const withOld = tap(withChanged(rows, [crossedOut]), [crossedOut], 'given', {
      target: 'row',
    });
    expect(withOld?.event.payload.lotAffected.map((affected) => affected.rowId)).toEqual([
      rowOfOwner(rows, 'Jos Patate').rowId,
    ]);
  });

  it('refuses a status it does not know', () => {
    expect(() => tap(start, trempette, 'validated')).toThrow('Unknown status validated');
  });
});

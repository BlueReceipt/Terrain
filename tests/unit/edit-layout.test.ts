import { describe, expect, it } from 'vitest';
import { editableColumns, editLayout, type LayoutField } from '../../src/domain/editLayout.ts';
import type { Row } from '../../src/domain/types.ts';
import { CO_OWNERS, houseOf, miniCampaign, rowOf, rowOfOwner } from '../support/campaign.ts';
import { importInto, parseFixture } from '../support/import.ts';

const plan = importInto(parseFixture('public/cases.kmz'));
const { campaign } = plan;
const rows = plan.merge.rows;
const alain = rowOf(rows, 'P1-216B', 'Alain');
const marie = rowOf(rows, 'P1-216B', 'Marie');
const alain217 = rowOf(rows, 'P1-217A', 'Alain');
const trempette = houseOf(rows, alain);

function fieldOf(fields: readonly LayoutField[], column: string): LayoutField[] {
  return fields.filter((field) => field.column === column);
}

describe('editLayout', () => {
  it('leaves out the app-owned columns, the parcel ID and coordinates', () => {
    const columns = editableColumns(campaign).map((entry) => entry.column);
    for (const app of ['Package status', 'Visit date', 'Call date', 'call result', 'Notes'])
      expect(columns).not.toContain(app);
    expect(columns).toContain('ADRESSE');
    expect(columns).toContain('Contact person');
  });

  it('puts a fix on one co-owner only, never on the other owner of the parcel (Alex, 2026-10-01)', () => {
    const mini = miniCampaign(CO_OWNERS);
    const patou = rowOfOwner(mini.merge.rows, 'Cantine la patate a Patou');
    const poutinerie = rowOfOwner(mini.merge.rows, 'La Poutinerie');
    expect(patou.houseKey).toBe(poutinerie.houseKey);
    const layout = editLayout(mini.merge.rows, mini.campaign);
    expect(layout.house).toEqual([]);
    expect(layout.people.map((owner) => [owner.name, owner.rowIds])).toEqual([
      ['Cantine la patate a Patou', [patou.rowId]],
      ['La Poutinerie', [poutinerie.rowId]],
    ]);
    const poutinerieFields = layout.people[1]?.fields ?? [];
    for (const column of ['TEL_RES', 'CELLULAIRE', 'ADRESSE', 'MUNICIPALITE', 'CODE_POSTAL']) {
      expect(fieldOf(poutinerieFields, column).map((field) => field.rowIds)).toEqual([
        [poutinerie.rowId],
      ]);
    }
  });

  it('shows each owner’s fields once, written on every row of that owner at the house', () => {
    const layout = editLayout(trempette, campaign);
    expect(layout.people.map((owner) => [owner.name, owner.rowIds])).toEqual([
      ['Alain Trempette', [alain.rowId, alain217.rowId]],
      ['Marie Trempette', [marie.rowId]],
    ]);
    const cells = layout.people.map((owner) => fieldOf(owner.fields, 'CELLULAIRE'));
    expect(cells).toEqual([
      [
        {
          column: 'CELLULAIRE',
          value: '450 555-0123',
          rowIds: [alain.rowId, alain217.rowId],
          differs: false,
          edited: false,
        },
      ],
      [
        {
          column: 'CELLULAIRE',
          value: '514 555-0199',
          rowIds: [marie.rowId],
          differs: false,
          edited: false,
        },
      ],
    ]);
    // The shared home line too: each owner's own field, never both owners at once.
    expect(
      layout.people.map((owner) => fieldOf(owner.fields, 'TEL_RES').map((f) => f.rowIds)),
    ).toEqual([[[alain.rowId, alain217.rowId]], [[marie.rowId]]]);
  });

  it('shows an owner’s field per row, marked "differs", when that owner’s rows disagree', () => {
    const corrected: Row = { ...alain217, edits: { CELLULAIRE: '450 555-0124' } };
    const layout = editLayout([alain, marie, corrected], campaign);
    expect(fieldOf(layout.people[0]?.fields ?? [], 'CELLULAIRE')).toEqual([
      {
        column: 'CELLULAIRE',
        value: '450 555-0123',
        rowIds: [alain.rowId],
        differs: true,
        edited: false,
      },
      {
        column: 'CELLULAIRE',
        value: '450 555-0124',
        rowIds: [alain217.rowId],
        differs: true,
        edited: true,
      },
    ]);
  });

  it('never groups rows that name no one', () => {
    const mini = miniCampaign([
      { parcel: 'P6-1', appel: 'Monsieur', address: '7 rue Rôti' },
      { parcel: 'P6-2', appel: 'Monsieur', address: '7 rue Rôti' },
    ]);
    const layout = editLayout(mini.merge.rows, mini.campaign);
    expect(layout.people.map((owner) => owner.rowIds.length)).toEqual([1, 1]);
  });

  it('shows parcel fields once per parcel ID, each writing that parcel’s rows at the house', () => {
    const layout = editLayout(trempette, campaign);
    expect(layout.parcels.map((parcel) => [parcel.parcelId, parcel.rowIds])).toEqual([
      ['P1-216B', [alain.rowId, marie.rowId]],
      ['P1-217A', [alain217.rowId]],
    ]);
    const numLot = layout.parcels.map((parcel) => fieldOf(parcel.fields, 'NUM_LOT')[0]);
    expect(numLot.map((field) => [field?.value, field?.rowIds])).toEqual([
      ['1 234 500', [alain.rowId, marie.rowId]],
      ['1 234 501', [alain217.rowId]],
    ]);
  });

  it('still shares a column set as a house field: once when the rows agree, per row when not', () => {
    const shared = {
      ...campaign,
      columnGroups: { ...campaign.columnGroups, 'Contact person': 'house' as const },
    };
    const agreeing = trempette.map((row) => ({ ...row, edits: { 'Contact person': 'Locataire' } }));
    expect(editLayout(agreeing, shared).house).toEqual([
      {
        column: 'Contact person',
        value: 'Locataire',
        rowIds: [alain.rowId, marie.rowId, alain217.rowId],
        differs: false,
        edited: true,
      },
    ]);
    const disagreeing = [agreeing[0], marie, agreeing[2]].filter((row) => row !== undefined);
    expect(
      editLayout(disagreeing, shared).house.map((field) => [field.rowIds, field.differs]),
    ).toEqual([
      [[alain.rowId], true],
      [[marie.rowId], true],
      [[alain217.rowId], true],
    ]);
  });

  it('writes each field to exactly the rows it covers, and each row once per column', () => {
    const layout = editLayout(trempette, campaign);
    const all = [
      ...layout.house,
      ...layout.parcels.flatMap((parcel) => parcel.fields),
      ...layout.people.flatMap((owner) => owner.fields),
    ];
    const written = all.flatMap((field) => field.rowIds.map((rowId) => `${rowId}|${field.column}`));
    expect(new Set(written).size).toBe(written.length);
    expect(written).toHaveLength(editableColumns(campaign).length * trempette.length);
  });

  it('keeps a cell listing several parcel IDs as one parcel, apart from rows of one of its IDs', () => {
    const atJoBine = { address: '2121 Avenue Principale', town: 'Saint-Élie-de-Caxton' };
    const mini = miniCampaign([
      { parcel: 'PT7-012/011/010', company: 'Casse-croûte Jo-Bine', numLot: '1', ...atJoBine },
      { parcel: 'PT7-012', company: 'Restaurant Max Poutine', numLot: '2', ...atJoBine },
    ]);
    const layout = editLayout(mini.merge.rows, mini.campaign);
    expect(layout.parcels.map((parcel) => parcel.parcelId)).toEqual(['PT7-012/011/010', 'PT7-012']);
  });
});

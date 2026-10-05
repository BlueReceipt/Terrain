import { describe, expect, it } from 'vitest';
import { planEdit, planNote, planNoteDeletion, planUndo } from '../../src/domain/actions.ts';
import type { NoteAddedEvent, TerrainEvent } from '../../src/domain/events.ts';
import type { DateFormat } from '../../src/domain/format.ts';
import { planStatusChange } from '../../src/domain/lots.ts';
import { notesByRow, notesCell } from '../../src/domain/notes.ts';
import { DEFAULT_STATUSES } from '../../src/domain/statuses.ts';
import type { Row } from '../../src/domain/types.ts';
import { strings } from '../../src/ui/strings.ts';
import { houseOf, miniCampaign, rowOf, rowOfOwner, withChanged } from '../support/campaign.ts';
import { importInto, NOW, parseFixture } from '../support/import.ts';

const LATER = '2026-09-27T09:15:00-04:00';
const words = strings.notes;
const plan = importInto(parseFixture('public/cases.kmz'));
const roles = plan.campaign.roles;
const start = plan.merge.rows;
const alain = rowOf(start, 'P1-216B', 'Alain');
const marie = rowOf(start, 'P1-216B', 'Marie');
const luc = rowOf(start, 'P1-216B', 'Luc');

function tapHouse(rows: readonly Row[], at: Row, statusId: string, eventId = 'tap-1', now = NOW) {
  const planned = planStatusChange({
    eventId,
    campaignId: plan.campaign.id,
    now,
    houseKey: at.houseKey,
    target: 'house',
    targetRows: houseOf(rows, at),
    lotRowsElsewhere: rows.filter((row) => row.houseKey !== at.houseKey),
    statuses: DEFAULT_STATUSES,
    statusId,
    roles,
    fillVisitDateViaLot: true,
  });
  if (!planned) throw new Error('The tap changed nothing');
  return planned;
}

function notesOf(
  rows: readonly Row[],
  events: readonly TerrainEvent[],
  row: Row,
  format: DateFormat = 'DD.MM.YYYY HH:mm',
) {
  return notesByRow(rows, events, words, format).get(row.rowId) ?? [];
}

describe('lot notes', () => {
  it('name every owner of a several-owner house, joined with " / ", where and when (Alex: 26.09.2026 14:32)', () => {
    const given = tapHouse(start, alain, 'given');
    expect(notesOf(start, [given.event], luc).map((note) => note.text)).toEqual([
      'Given with Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 26.09.2026 14:32',
    ]);
  });

  it('name the owner of a one-owner house, on every co-owner row elsewhere', () => {
    const given = tapHouse(start, luc, 'given');
    for (const row of [alain, marie]) {
      expect(notesOf(start, [given.event], row)).toEqual([
        {
          eventId: 'tap-1',
          kind: 'lot',
          at: NOW,
          text: 'Given with Luc Trempette at 12, chemin du Lac, 26.09.2026 14:32',
          rowIds: [alain.rowId, marie.rowId],
        },
      ]);
    }
  });

  it('say "co-owner to research" on the co-owners elsewhere when a row is marked To research', () => {
    const research = tapHouse(start, luc, 'to-research');
    expect(notesOf(start, [research.event], alain).map((note) => note.text)).toEqual([
      'Co-owner to research: Luc Trempette at 12, chemin du Lac, 26.09.2026 14:32',
    ]);
  });

  it('are never on the rows the tap marked', () => {
    const given = tapHouse(start, alain, 'given');
    for (const row of houseOf(start, alain)) expect(notesOf(start, [given.event], row)).toEqual([]);
  });

  it('use APPEL when PRENOM and NOM are blank, and "someone" when nothing names an owner', () => {
    const mini = miniCampaign([
      { parcel: 'P5-1', appel: 'Succession Grains', address: '3 rang Nord' },
      { parcel: 'P5-1', first: 'Rita', last: 'Grains', address: '8 rue Lussier' },
      { parcel: 'P5-2', address: '40 rang Sud' },
      { parcel: 'P5-2', first: 'Yves', last: 'Grains', address: '9 rue Lussier' },
    ]);
    const rows = mini.merge.rows;
    const succession = rows[0];
    const nobody = rows[2];
    if (!succession || !nobody) throw new Error('Missing rows');
    const first = tapHouse(rows, succession, 'given');
    expect(notesOf(rows, [first.event], rowOf(rows, 'P5-1', 'Rita'))[0]?.text).toBe(
      'Given with Succession Grains at 3 rang Nord, 26.09.2026 14:32',
    );
    const second = tapHouse(rows, nobody, 'given', 'tap-2');
    expect(notesOf(rows, [second.event], rowOf(rows, 'P5-2', 'Yves'))[0]?.text).toBe(
      'Given with someone at 40 rang Sud, 26.09.2026 14:32',
    );
  });

  it('name a pin with no address by its parcel ID', () => {
    const mini = miniCampaign([
      { parcel: 'P6-7', company: 'Casse-croûte chez Jojo' },
      { parcel: 'P6-7', company: 'Jos Patate', address: '21 Rue Maple', town: 'Grenville' },
    ]);
    const rows = mini.merge.rows;
    const jojo = rowOfOwner(rows, 'Casse-croûte chez Jojo');
    const given = tapHouse(rows, jojo, 'given');
    expect(notesOf(rows, [given.event], rowOfOwner(rows, 'Jos Patate'))[0]?.text).toBe(
      'Given with Casse-croûte chez Jojo at the P6-7 pin, 26.09.2026 14:32',
    );
  });

  it('write the time of the tap in the chosen format, in the local time of the tap', () => {
    const given = tapHouse(start, luc, 'given', 'tap-1', '2026-09-26T09:05:59-04:00');
    expect(notesOf(start, [given.event], alain, 'YYYY-MM-DD HH:mm')[0]?.text).toBe(
      'Given with Luc Trempette at 12, chemin du Lac, 2026-09-26 09:05',
    );
  });

  it('keep the names and address of the moment of the tap after a later correction', () => {
    const given = tapHouse(start, alain, 'given');
    const rows = withChanged(start, given.rows);
    const corrected = planEdit({
      eventId: 'edit-1',
      campaignId: plan.campaign.id,
      now: LATER,
      houseKey: alain.houseKey,
      target: 'house',
      rows: houseOf(rows, alain),
      writes: [
        {
          rowIds: [alain.rowId, rowOf(rows, 'P1-217A', 'Alain').rowId],
          column: 'PRENOM',
          value: 'Alan',
        },
        {
          rowIds: houseOf(rows, alain).map((row) => row.rowId),
          column: 'ADRESSE',
          value: '125 rue Saint-Paul',
        },
      ],
    });
    expect(corrected).not.toBeNull();
    const events = [given.event, ...(corrected ? [corrected.event] : [])];
    expect(notesOf(withChanged(rows, corrected?.rows ?? []), events, luc)[0]?.text).toBe(
      'Given with Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 26.09.2026 14:32',
    );
  });

  it('disappear when the tap is undone', () => {
    const given = tapHouse(start, alain, 'given');
    const undo = planUndo({
      eventId: 'undo-1',
      campaignId: plan.campaign.id,
      now: LATER,
      undone: given.event,
      rows: withChanged(start, given.rows),
    });
    expect(notesOf(start, [given.event, undo.event], luc)).toEqual([]);
  });
});

describe('house and row notes', () => {
  const context = { campaignId: plan.campaign.id, houseKey: alain.houseKey };
  const house = houseOf(start, alain).map((row) => row.rowId);
  const houseNote = planNote({
    ...context,
    eventId: 'note-1',
    now: NOW,
    rowIds: house,
    target: 'house',
    text: '  Cantine Alain, confirmer avec Alain  ',
  }) as NoteAddedEvent;
  const rowNote = planNote({
    ...context,
    eventId: 'note-2',
    now: LATER,
    rowIds: [marie.rowId],
    target: 'row',
    text: 'Marie answers after 18:00',
  }) as NoteAddedEvent;

  it('cover every row at the house, or one row, newest first, with the imported Notes cell last', () => {
    const rows = start.map((row) =>
      row.rowId === marie.rowId ? { ...row, importedNotes: 'Chien méchant' } : row,
    );
    expect(houseNote.payload.text).toBe('Cantine Alain, confirmer avec Alain');
    expect(houseNote.rowIds).toEqual(house);
    const notes = notesOf(rows, [houseNote, rowNote], rowOf(rows, 'P1-216B', 'Marie'));
    expect(notes.map((note) => [note.kind, note.text])).toEqual([
      ['row', 'Marie answers after 18:00'],
      ['house', 'Cantine Alain, confirmer avec Alain'],
      ['imported', 'Chien méchant'],
    ]);
    expect(notesOf(rows, [houseNote, rowNote], alain).map((note) => note.kind)).toEqual(['house']);
  });

  it('are not written when empty', () => {
    expect(
      planNote({ ...context, eventId: 'n', now: NOW, rowIds: house, target: 'house', text: '  ' }),
    ).toBeNull();
  });

  it('leave every row they covered when deleted, and come back when the deletion is undone', () => {
    const deletion = planNoteDeletion({
      eventId: 'delete-1',
      campaignId: plan.campaign.id,
      now: LATER,
      note: houseNote,
    });
    expect(deletion.rowIds).toEqual(house);
    expect(notesOf(start, [houseNote, deletion], alain)).toEqual([]);
    const undo = planUndo({
      eventId: 'undo-1',
      campaignId: plan.campaign.id,
      now: LATER,
      undone: deletion,
      rows: start,
    });
    expect(undo.rows).toEqual([]);
    expect(notesOf(start, [houseNote, deletion, undo.event], alain)).toHaveLength(1);
  });
});

describe('the Notes cell of an export', () => {
  it('joins every note oldest first, dating house and row notes, and a lot note keeps its one timestamp', () => {
    const given = tapHouse(start, alain, 'given');
    const note = planNote({
      eventId: 'note-1',
      campaignId: plan.campaign.id,
      now: LATER,
      houseKey: luc.houseKey,
      rowIds: [luc.rowId],
      target: 'house',
      text: 'Luc works nights',
    });
    const rows = start.map((row) =>
      row.rowId === luc.rowId ? { ...row, importedNotes: 'Envoyer copie au fils' } : row,
    );
    const events = note ? [given.event, note] : [given.event];
    const notes = notesOf(rows, events, rowOf(rows, 'P1-216B', 'Luc'));
    const joined = notesCell(notes, 'joined', words, 'DD.MM.YYYY HH:mm');
    expect(joined).toBe(
      [
        'Envoyer copie au fils',
        'Given with Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 26.09.2026 14:32',
        '27.09.2026 09:15 - Luc works nights',
      ].join('\n'),
    );
    expect(joined.match(/26\.09\.2026 14:32/g)).toHaveLength(1);
    expect(notesCell(notes, 'latest', words, 'DD.MM.YYYY HH:mm')).toBe(
      '27.09.2026 09:15 - Luc works nights',
    );
  });
});

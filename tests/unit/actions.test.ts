import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerrainDb } from '../../src/data/db.ts';
import {
  addNote,
  campaignEvents,
  commitImport,
  deleteNote,
  discardCall,
  editFields,
  logCall,
  markExported,
  markHouse,
  moveHouse,
  notExportedCount,
  pendingCalls,
  resolveCall,
  startCall,
  undo,
} from '../../src/data/repo.ts';
import { editLayout } from '../../src/domain/editLayout.ts';
import { stateOf } from '../../src/domain/events.ts';
import { initialColorMap, planImport } from '../../src/domain/importPlan.ts';
import { DEFAULT_STATUSES } from '../../src/domain/statuses.ts';
import type { Row } from '../../src/domain/types.ts';
import {
  casesCampaign,
  CO_OWNERS,
  freshDb,
  houseOf,
  miniCampaign,
  rowOf,
  rowOfOwner,
  storedRows,
} from '../support/campaign.ts';
import { counter, NOW, parseFixture } from '../support/import.ts';

const LATER = '2026-09-26T15:10:00-04:00';
let db: TerrainDb;
afterEach(async () => {
  db.close();
  await db.delete();
});

/** Everything about a row except when it was last written. */
function content(row: Row): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updatedAt'));
}

async function setUp() {
  db = freshDb();
  const plan = await casesCampaign(db);
  const rows = await storedRows(db, plan.campaign.id);
  const alain = rowOf(rows, 'P1-216B', 'Alain');
  return {
    campaignId: plan.campaign.id,
    rows,
    alain,
    marie: rowOf(rows, 'P1-216B', 'Marie'),
    alain217: rowOf(rows, 'P1-217A', 'Alain'),
    luc: rowOf(rows, 'P1-216B', 'Luc'),
    houseKey: alain.houseKey,
  };
}

describe('corrections (Edit info)', () => {
  it('fixes one co-owner’s number without touching the other owner of the parcel (Alex, 2026-10-01)', async () => {
    db = freshDb();
    const mini = miniCampaign(CO_OWNERS);
    await commitImport(db, mini, 'import-1', NOW);
    const campaignId = mini.campaign.id;
    const before = await storedRows(db, campaignId);
    const poutinerie = rowOfOwner(before, 'La Poutinerie');
    const layout = editLayout(houseOf(before, poutinerie), mini.campaign);
    const phone = layout.people
      .find((owner) => owner.name === 'La Poutinerie')
      ?.fields.find((field) => field.column === 'TEL_RES');
    await editFields(db, {
      campaignId,
      houseKey: poutinerie.houseKey,
      target: 'house',
      eventId: 'edit-1',
      now: LATER,
      writes: [{ rowIds: phone?.rowIds ?? [], column: 'TEL_RES', value: '418 555-0143' }],
    });
    const after = await storedRows(db, campaignId);
    expect(rowOfOwner(after, 'La Poutinerie').edits).toEqual({ TEL_RES: '418 555-0143' });
    expect(rowOfOwner(after, 'Cantine la patate a Patou')).toEqual(
      rowOfOwner(before, 'Cantine la patate a Patou'),
    );
  });

  it('saves several rows and fields in one event, with previous and new values, and undo puts them back', async () => {
    const { campaignId, rows, alain, marie, alain217, houseKey } = await setUp();
    const saved = await editFields(db, {
      campaignId,
      houseKey,
      target: 'house',
      eventId: 'edit-1',
      now: LATER,
      writes: [
        {
          rowIds: [alain.rowId, marie.rowId, alain217.rowId],
          column: 'TEL_RES',
          value: '450 555-0111',
        },
        { rowIds: [marie.rowId], column: 'CELLULAIRE', value: '514 555-0100' },
        { rowIds: [alain217.rowId], column: 'NUM_LOT', value: '1 234 502' },
      ],
    });
    expect(saved?.event.type).toBe('fields_edited');
    expect(saved?.event.rowIds).toEqual([alain.rowId, marie.rowId, alain217.rowId]);
    const after = await storedRows(db, campaignId);
    expect(rowOf(after, 'P1-216B', 'Marie').edits).toEqual({
      TEL_RES: '450 555-0111',
      CELLULAIRE: '514 555-0100',
    });
    expect(rowOf(after, 'P1-217A', 'Alain').edits).toEqual({
      TEL_RES: '450 555-0111',
      NUM_LOT: '1 234 502',
    });
    if (saved?.event.type !== 'fields_edited') throw new Error('No edit');
    expect(saved.event.payload.changes).toContainEqual({
      rowId: marie.rowId,
      column: 'CELLULAIRE',
      previous: '514 555-0199',
      next: '514 555-0100',
      previousEdit: null,
      nextEdit: '514 555-0100',
    });
    // The fingerprint stays on imported values: a re-import still finds these rows.
    expect(after.map((row) => row.fingerprint)).toEqual(rows.map((row) => row.fingerprint));

    await undo(db, { campaignId, undoneEventId: 'edit-1', eventId: 'undo-1', now: LATER });
    expect((await storedRows(db, campaignId)).map(content)).toEqual(rows.map(content));
  });

  it('drops a correction set back to the imported value', async () => {
    const { campaignId, marie, houseKey } = await setUp();
    const write = (value: string, eventId: string) =>
      editFields(db, {
        campaignId,
        houseKey,
        target: 'row',
        eventId,
        now: LATER,
        writes: [{ rowIds: [marie.rowId], column: 'CELLULAIRE', value }],
      });
    await write('514 555-0100', 'edit-1');
    await write('514 555-0199', 'edit-2');
    expect(rowOf(await storedRows(db, campaignId), 'P1-216B', 'Marie').edits).toEqual({});
    expect(await write('514 555-0199', 'edit-3')).toBeNull();
  });

  it('regroups houses when an address is corrected, and back on undo', async () => {
    const { campaignId, rows, luc, alain } = await setUp();
    await editFields(db, {
      campaignId,
      houseKey: luc.houseKey,
      target: 'row',
      eventId: 'edit-1',
      now: LATER,
      writes: [{ rowIds: [luc.rowId], column: 'ADRESSE', value: '123 rue St-Paul' }],
    });
    const moved = await storedRows(db, campaignId);
    expect(rowOf(moved, 'P1-216B', 'Luc').houseKey).toBe(alain.houseKey);
    expect(houseOf(moved, alain)).toHaveLength(4);

    await undo(db, { campaignId, undoneEventId: 'edit-1', eventId: 'undo-1', now: LATER });
    const back = await storedRows(db, campaignId);
    expect(rowOf(back, 'P1-216B', 'Luc').houseKey).toBe(luc.houseKey);
    expect(back.map(content)).toEqual(rows.map(content));
  });

  it('regroups lots when the lot column is corrected', async () => {
    db = freshDb();
    const parsed = parseFixture('public/cases.kmz');
    const plan = planImport({
      parsed,
      campaign: null,
      existingRows: [],
      statuses: DEFAULT_STATUSES,
      roles: parsed.roles,
      colorMap: initialColorMap(parsed, DEFAULT_STATUSES).colorMap,
      lotColumn: 'NUM_LOT',
      now: NOW,
      newId: counter('r'),
    });
    await commitImport(db, plan, 'import-1', NOW);
    const rows = await storedRows(db, plan.campaign.id);
    const alain217 = rowOf(rows, 'P1-217A', 'Alain');
    expect(alain217.lotKeys).toEqual(['1234501']);
    await editFields(db, {
      campaignId: plan.campaign.id,
      houseKey: alain217.houseKey,
      target: 'row',
      eventId: 'edit-1',
      now: LATER,
      writes: [{ rowIds: [alain217.rowId], column: 'NUM_LOT', value: '1 234 500' }],
    });
    expect(rowOf(await storedRows(db, plan.campaign.id), 'P1-217A', 'Alain').lotKeys).toEqual([
      '1234500',
    ]);
  });
});

describe('Use my location for this house', () => {
  it('moves every row at the house, and undo moves them back exactly', async () => {
    const { campaignId, rows, houseKey } = await setUp();
    const here = { lat: 45.26412, lng: -73.61049 };
    const moved = await moveHouse(db, {
      campaignId,
      houseKey,
      eventId: 'move-1',
      now: LATER,
      position: here,
      accuracyM: 8,
    });
    expect(moved?.rows).toHaveLength(3);
    for (const row of houseOf(await storedRows(db, campaignId), rowOf(rows, 'P1-216B', 'Alain'))) {
      expect(row.position).toEqual(here);
      expect(row.touched.moved).toBe(true);
    }
    await undo(db, { campaignId, undoneEventId: 'move-1', eventId: 'undo-1', now: LATER });
    expect((await storedRows(db, campaignId)).map(content)).toEqual(rows.map(content));
  });
});

describe('calls', () => {
  it('logs a call to the shared home line on every row listing it, and a cell on its row only', async () => {
    const { campaignId, rows, alain, marie, alain217, houseKey } = await setUp();
    const home = await logCall(db, {
      campaignId,
      houseKey,
      eventId: 'call-1',
      now: LATER,
      number: '(450) 555-0100',
      outcome: 'Info good',
      callDate: LATER,
      scope: 'number',
    });
    expect(home.rows.map((row) => row.rowId)).toEqual([alain.rowId, marie.rowId, alain217.rowId]);
    const cell = await logCall(db, {
      campaignId,
      houseKey,
      eventId: 'call-2',
      now: LATER,
      number: '514 555 0199',
      outcome: 'Voicemail',
      callDate: LATER,
      scope: 'number',
    });
    expect(cell.rows.map((row) => row.rowId)).toEqual([marie.rowId]);
    const after = await storedRows(db, campaignId);
    expect(rowOf(after, 'P1-216B', 'Marie')).toMatchObject({
      callDate: LATER,
      callResult: 'Voicemail',
    });
    expect(rowOf(after, 'P1-216B', 'Alain')).toMatchObject({ callResult: 'Info good' });
    // A call changes Call date and call result only: never a status, never another house.
    expect(rowOf(after, 'P1-216B', 'Alain').statusId).toBe(alain.statusId);
    expect(rowOf(after, 'P1-216B', 'Luc')).toEqual(rowOf(rows, 'P1-216B', 'Luc'));
  });

  it('logs a number no row lists on the whole house', async () => {
    const { campaignId, houseKey } = await setUp();
    const call = await logCall(db, {
      campaignId,
      houseKey,
      eventId: 'call-1',
      now: LATER,
      number: '819 555-0000',
      outcome: 'Wrong number',
      callDate: LATER,
      scope: 'number',
    });
    expect(call.rows).toHaveLength(3);
    expect(call.event.type === 'call_logged' && call.event.payload.scope).toBe('house');
  });

  it('keeps a pending call through the dialer and logs its outcome at the time it started', async () => {
    const { campaignId, alain, alain217, houseKey } = await setUp();
    const pending = await startCall(db, {
      id: 'pending-1',
      campaignId,
      houseKey,
      number: '450 555-0123',
      startedAt: NOW,
    });
    expect(pending.rowIds).toEqual([alain.rowId, alain217.rowId]);
    expect(await pendingCalls(db, campaignId)).toEqual([pending]);
    const resolved = await resolveCall(db, {
      pendingId: 'pending-1',
      outcome: 'Info changed',
      eventId: 'call-1',
      now: LATER,
    });
    expect(resolved?.rows.map((row) => [row.rowId, row.callDate, row.callResult])).toEqual([
      [alain.rowId, NOW, 'Info changed'],
      [alain217.rowId, NOW, 'Info changed'],
    ]);
    expect(await pendingCalls(db, campaignId)).toEqual([]);

    await startCall(db, {
      id: 'pending-2',
      campaignId,
      houseKey,
      number: '450 555-0100',
      startedAt: LATER,
    });
    await discardCall(db, 'pending-2');
    expect(await pendingCalls(db, campaignId)).toEqual([]);
  });
});

describe('notes, undo and the not-exported counter', () => {
  it('adds a house note on every row, deletes it, and refuses to delete it twice', async () => {
    const { campaignId, houseKey, alain, marie, alain217 } = await setUp();
    const note = await addNote(db, {
      campaignId,
      houseKey,
      rowId: null,
      eventId: 'note-1',
      now: LATER,
      text: 'Cantine Alain',
    });
    expect(note?.rowIds).toEqual([alain.rowId, marie.rowId, alain217.rowId]);
    expect(
      await deleteNote(db, { campaignId, noteEventId: 'note-1', eventId: 'delete-1', now: LATER }),
    ).not.toBeNull();
    expect(
      await deleteNote(db, { campaignId, noteEventId: 'note-1', eventId: 'delete-2', now: LATER }),
    ).toBeNull();
  });

  it('undoes only the last action, and nothing right after an import', async () => {
    const { campaignId, houseKey } = await setUp();
    expect(
      await undo(db, { campaignId, undoneEventId: 'import-1', eventId: 'undo-0', now: LATER }),
    ).toBeNull();
    await markHouse(db, { campaignId, houseKey, statusId: 'given', eventId: 'tap-1', now: LATER });
    await addNote(db, {
      campaignId,
      houseKey,
      rowId: null,
      eventId: 'note-1',
      now: LATER,
      text: 'Hi',
    });
    expect(
      await undo(db, { campaignId, undoneEventId: 'tap-1', eventId: 'undo-1', now: LATER }),
    ).toBeNull();
    expect(
      await undo(db, { campaignId, undoneEventId: 'note-1', eventId: 'undo-2', now: LATER }),
    ).not.toBeNull();
    const events = await campaignEvents(db, campaignId);
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'import'],
      [2, 'status_set'],
      [3, 'note_added'],
      [4, 'undo'],
    ]);
  });

  it('undoes a Given that closed the lot: every row it touched, at both houses', async () => {
    const { campaignId, rows, houseKey } = await setUp();
    const tap = await markHouse(db, {
      campaignId,
      houseKey,
      statusId: 'given',
      eventId: 'tap-1',
      now: LATER,
    });
    expect(tap?.rows).toHaveLength(4);
    await undo(db, { campaignId, undoneEventId: 'tap-1', eventId: 'undo-1', now: LATER });
    const after = await storedRows(db, campaignId);
    expect(after.map(stateOf)).toEqual(rows.map(stateOf));
  });

  it('counts the changes not exported yet', async () => {
    const { campaignId, houseKey, luc } = await setUp();
    expect(await notExportedCount(db, campaignId)).toBe(0);
    await markHouse(db, {
      campaignId,
      houseKey,
      statusId: 'at-door',
      eventId: 'tap-1',
      now: LATER,
    });
    await markHouse(db, {
      campaignId,
      houseKey: luc.houseKey,
      statusId: 'given',
      eventId: 'tap-2',
      now: LATER,
    });
    await addNote(db, {
      campaignId,
      houseKey,
      rowId: null,
      eventId: 'note-1',
      now: LATER,
      text: 'Hi',
    });
    expect(await notExportedCount(db, campaignId)).toBe(3);
    await undo(db, { campaignId, undoneEventId: 'note-1', eventId: 'undo-1', now: LATER });
    expect(await notExportedCount(db, campaignId)).toBe(2);
    await markExported(db, campaignId, LATER);
    expect(await notExportedCount(db, campaignId)).toBe(0);
    // Taking back something the client already received is a change to send.
    await addNote(db, {
      campaignId,
      houseKey,
      rowId: null,
      eventId: 'note-2',
      now: LATER,
      text: 'Bye',
    });
    await markExported(db, campaignId, LATER);
    await undo(db, { campaignId, undoneEventId: 'note-2', eventId: 'undo-2', now: LATER });
    expect(await notExportedCount(db, campaignId)).toBe(1);
  });
});

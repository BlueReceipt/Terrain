import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerrainDb } from '../../src/data/db.ts';
import { campaignEvents, editFields, loadCampaign, markHouse, undo } from '../../src/data/repo.ts';
import type { EditWrite } from '../../src/domain/actions.ts';
import { dayLog, dayLogText } from '../../src/domain/daylog.ts';
import { foldStates, stateOf } from '../../src/domain/events.ts';
import { journalSheet } from '../../src/domain/export/journal.ts';
import { parcelsSheet } from '../../src/domain/export/sheet.ts';
import { currentValue } from '../../src/domain/identity.ts';
import { initialColorMap, planImport } from '../../src/domain/importPlan.ts';
import {
  ownerColumns,
  ownerDetails,
  PREVIOUS_INFO,
  previousInfoColumn,
  withPreviousOwner,
} from '../../src/domain/newOwner.ts';
import { DEFAULT_STATUSES } from '../../src/domain/statuses.ts';
import type { Campaign, Row } from '../../src/domain/types.ts';
import { strings } from '../../src/ui/strings.ts';
import { COLUMNS } from '../../scripts/make-fixtures.ts';
import { casesCampaign, freshDb, rowOf } from '../support/campaign.ts';
import { counter, NOW, parseFixture } from '../support/import.ts';

// Alex, 2026-10-06: at the door, a new owner. Edit info → New owner moves the owner's name and
// numbers to Previous info and takes the new owner's.

let db: TerrainDb | null = null;
afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = null;
});

/** The test's database, once it has one. */
function store(): TerrainDb {
  if (!db) throw new Error('No database');
  return db;
}

const at = (time: string) => `2026-09-26T${time}:00-04:00`;

async function loaded(campaignId: string) {
  const campaign = await loadCampaign(store(), campaignId);
  if (!campaign) throw new Error('No campaign');
  return { ...campaign, events: await campaignEvents(store(), campaignId) };
}

/** What Edit info saves for New owner on one row: the new owner's values, the old ones kept. */
function newOwnerWrites(campaign: Campaign, row: Row, values: Record<string, string>): EditWrite[] {
  const columns = ownerColumns(campaign.columnOrder, campaign.roles);
  const details = ownerDetails(row, columns, campaign.roles);
  const previousColumn = previousInfoColumn(campaign.columnOrder);
  return [
    {
      rowIds: [row.rowId],
      column: previousColumn,
      value: withPreviousOwner(
        currentValue(row, previousColumn),
        strings.edit.previousOwner(details, '26.09.2026'),
      ),
    },
    ...columns.map((column) => ({ rowIds: [row.rowId], column, value: values[column] ?? '' })),
  ];
}

describe('the owner columns', () => {
  it('are the name, phones, fax and email, not the address or the renter', () => {
    const roles = parseFixture('public/cases.kmz').roles;
    expect(ownerColumns(COLUMNS, roles)).toEqual([
      'Propriétaire',
      'APPEL',
      'PRENOM',
      'NOM',
      'TEL_RES',
      'CELLULAIRE',
      'TEL_BUR',
      'TELECOPIEUR',
      'COURRIEL',
    ]);
  });

  it('use a Previous info column of the campaign’s own, whatever its case', () => {
    expect(previousInfoColumn(['NOM', 'PREVIOUS INFO'])).toBe('PREVIOUS INFO');
    expect(previousInfoColumn(['NOM'])).toBe(PREVIOUS_INFO);
    expect(withPreviousOwner('', 'Marie Trempette (until 26.09.2026)')).toBe(
      'Marie Trempette (until 26.09.2026)',
    );
    expect(withPreviousOwner('Luc Grains (until 01.09.2026)', 'Marie Trempette')).toBe(
      'Luc Grains (until 01.09.2026)\nMarie Trempette',
    );
  });
});

describe('New owner', () => {
  it('keeps the old owner in Previous info, everywhere: card, day log, Journal, export, re-import, undo', async () => {
    db = freshDb();
    const plan = await casesCampaign(store());
    const campaignId = plan.campaign.id;
    const start = await loaded(campaignId);
    const marie = rowOf(start.rows, 'P1-216B', 'Marie');
    const house = { campaignId, houseKey: marie.houseKey };
    await markHouse(store(), {
      ...house,
      statusId: 'given',
      eventId: 'e1-given',
      now: at('14:32'),
    });

    // At 15:00 the door opens on Rosalie Frite, who bought Marie's part.
    const before = await loaded(campaignId);
    const result = await editFields(store(), {
      ...house,
      eventId: 'e2-owner',
      now: at('15:00'),
      target: 'house',
      writes: newOwnerWrites(before.campaign, rowOf(before.rows, 'P1-216B', 'Marie'), {
        PRENOM: 'Rosalie',
        NOM: 'Frite',
        CELLULAIRE: '418 555-0150',
      }),
      newOwners: [{ rowIds: [marie.rowId], previous: 'Marie Trempette', next: 'Rosalie Frite' }],
    });
    expect(result?.campaign?.columnOrder.at(-1)).toBe(PREVIOUS_INFO);
    expect(result?.campaign?.columnGroups[PREVIOUS_INFO]).toBe('person');

    const after = await loaded(campaignId);
    const rosalie = after.rows.find((row) => row.rowId === marie.rowId);
    if (!rosalie) throw new Error('No row');
    expect(
      ['APPEL', 'PRENOM', 'NOM', 'TEL_RES', 'CELLULAIRE'].map((c) => currentValue(rosalie, c)),
    ).toEqual(['', 'Rosalie', 'Frite', '', '418 555-0150']);
    expect(currentValue(rosalie, PREVIOUS_INFO)).toBe(
      'Marie Trempette, 450 555-0100, 514 555-0199 (until 26.09.2026)',
    );
    // Her status is the house's: Given at 14:32, and Rosalie's from now on.
    expect(rosalie.statusId).toBe('given');
    // The stored rows are the replay of the events.
    const folded = foldStates(after.rows, after.events, after.campaign.roles);
    for (const row of after.rows) expect(stateOf(row)).toEqual(folded.get(row.rowId));

    const log = dayLog({
      day: '2026-09-26',
      campaign: after.campaign,
      rows: after.rows,
      events: after.events,
      statuses: DEFAULT_STATUSES,
      words: strings.dayLog.words,
    });
    expect(
      dayLogText(log, 'cases', 'DD.MM.YYYY HH:mm', strings.dayLog.words).split('\n').at(-1),
    ).toBe('15:00  123, rue Saint-Paul  new owner: Rosalie Frite (was Marie Trempette)');
    expect(log.corrections).toBe(1);

    // The Journal names the owner of the time: Marie got Given at 14:32, Rosalie came at 15:00.
    const journal = journalSheet({
      campaign: after.campaign,
      rows: after.rows,
      events: after.events,
      statuses: DEFAULT_STATUSES,
      noteWords: strings.notes,
      words: strings.journal,
      format: 'DD.MM.YYYY HH:mm',
    });
    const forRow = journal.filter(
      (line) => line[3] === 'Marie Trempette' || line[3] === 'Rosalie Frite',
    );
    expect(forRow.map((line) => [line[1], line[3], line[5], line[6]])).toEqual([
      ['14:32', 'Marie Trempette', 'Status', 'Given'],
      ['15:00', 'Rosalie Frite', 'New owner', PREVIOUS_INFO],
      ['15:00', 'Rosalie Frite', 'New owner', 'APPEL'],
      ['15:00', 'Rosalie Frite', 'New owner', 'PRENOM'],
      ['15:00', 'Rosalie Frite', 'New owner', 'NOM'],
      ['15:00', 'Rosalie Frite', 'New owner', 'TEL_RES'],
      ['15:00', 'Rosalie Frite', 'New owner', 'CELLULAIRE'],
    ]);

    // The Excel export: Rosalie in the client's columns, Marie in Previous info, at the end.
    const [header = [], ...lines] = parcelsSheet({
      campaign: after.campaign,
      rows: after.rows,
      events: after.events,
      words: strings.notes,
      appHeaders: strings.exports.appHeaders,
      format: 'DD.MM.YYYY HH:mm',
      notesMode: 'joined',
    });
    expect(header.at(-1)).toBe(PREVIOUS_INFO);
    const line = lines.find((cells) => cells[header.indexOf('PRENOM')] === 'Rosalie');
    expect(line?.at(-1)).toBe('Marie Trempette, 450 555-0100, 514 555-0199 (until 26.09.2026)');

    // The client's file, still naming Marie, comes in again: Previous info isn't in it, so it stays,
    // with no disagreement to report; the new owner's name is a correction the file disagrees with.
    const parsed = parseFixture('public/cases.kmz');
    const again = planImport({
      parsed,
      campaign: after.campaign,
      existingRows: after.rows,
      statuses: DEFAULT_STATUSES,
      roles: after.campaign.roles,
      colorMap: initialColorMap(parsed, DEFAULT_STATUSES, after.campaign.colorMap).colorMap,
      lotColumn: after.campaign.lotColumn,
      now: NOW,
      newId: counter('n'),
    });
    const conflicts = again.merge.conflicts.filter((conflict) => conflict.rowId === marie.rowId);
    expect(conflicts.map((conflict) => conflict.column)).not.toContain(PREVIOUS_INFO);
    expect(conflicts.map((conflict) => conflict.column)).toContain('PRENOM');
    const kept = again.merge.rows.find((row) => row.rowId === marie.rowId);
    expect(kept?.edits[PREVIOUS_INFO]).toBe(
      'Marie Trempette, 450 555-0100, 514 555-0199 (until 26.09.2026)',
    );

    // Undo: Marie is back, Previous info empty again; the column stays in the campaign.
    await undo(store(), {
      campaignId,
      undoneEventId: 'e2-owner',
      eventId: 'e3-undo',
      now: at('15:01'),
    });
    const undone = await loaded(campaignId);
    const back = undone.rows.find((row) => row.rowId === marie.rowId);
    if (!back) throw new Error('No row');
    expect(currentValue(back, 'PRENOM')).toBe('Marie');
    expect(currentValue(back, PREVIOUS_INFO)).toBe('');
    expect(undone.campaign.columnOrder).toContain(PREVIOUS_INFO);
  });
});

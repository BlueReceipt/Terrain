import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerrainDb } from '../../src/data/db.ts';
import {
  campaignEvents,
  commitImport,
  editFields,
  loadCampaign,
  markHouse,
  undo,
} from '../../src/data/repo.ts';
import type { EditWrite } from '../../src/domain/actions.ts';
import { dayLog, dayLogText } from '../../src/domain/daylog.ts';
import { foldStates, stateOf, type TerrainEvent } from '../../src/domain/events.ts';
import { journalLines, journalSheet } from '../../src/domain/export/journal.ts';
import type { DateFormat } from '../../src/domain/format.ts';
import { parcelsSheet } from '../../src/domain/export/sheet.ts';
import { currentValue, readerFor } from '../../src/domain/identity.ts';
import { initialColorMap, planImport, type ImportPlan } from '../../src/domain/importPlan.ts';
import {
  isNewOwner,
  ownerColumns,
  ownerDetails,
  PREVIOUS_INFO,
  previousInfoColumn,
  previousVisit,
  visitWasBefore,
  withPreviousOwner,
} from '../../src/domain/newOwner.ts';
import { DEFAULT_STATUSES, startStatus } from '../../src/domain/statuses.ts';
import type { Campaign, ParsedFile, Row } from '../../src/domain/types.ts';
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

const FORMAT: DateFormat = 'DD.MM.YYYY HH:mm';

/** What Edit info saves for New owner on one row: the new owner's values, the old ones kept. */
function newOwnerWrites(
  campaign: Campaign,
  row: Row,
  values: Record<string, string>,
  visit = '',
): EditWrite[] {
  const columns = ownerColumns(campaign.columnOrder, campaign.roles);
  const details = [ownerDetails(row, columns, campaign.roles), visit].filter(Boolean).join(', ');
  const previousColumn = previousInfoColumn(campaign.columnOrder);
  return [
    {
      rowIds: [row.rowId],
      column: previousColumn,
      value: withPreviousOwner(
        currentValue(row, previousColumn),
        strings.previousInfo.previousOwner(details, '26.09.2026'),
      ),
    },
    ...columns.map((column) => ({ rowIds: [row.rowId], column, value: values[column] ?? '' })),
  ];
}

/** The client's file imported again into the campaign, the way the app does it. */
function reimport(
  parsed: ParsedFile,
  into: { campaign: Campaign; rows: Row[] },
  now: string,
): ImportPlan {
  return planImport({
    parsed,
    campaign: into.campaign,
    existingRows: into.rows,
    statuses: DEFAULT_STATUSES,
    roles: parsed.roles,
    colorMap: initialColorMap(parsed, DEFAULT_STATUSES, into.campaign.colorMap).colorMap,
    lotColumn: into.campaign.lotColumn,
    now,
    newId: counter('n'),
    previousInfo: { words: strings.previousInfo, format: FORMAT },
  });
}

/** Stored rows are the replay of the campaign's events. */
function expectReplayed(day: { campaign: Campaign; rows: Row[]; events: TerrainEvent[] }) {
  const folded = foldStates(day.rows, day.events, day.campaign.roles);
  for (const row of day.rows) expect(stateOf(row), row.rowId).toEqual(folded.get(row.rowId));
}

/** One row's Journal lines: date, owner, action, detail, previous and new value. */
function journalOf(
  day: { campaign: Campaign; rows: Row[]; events: TerrainEvent[] },
  rowId: string,
) {
  const input = {
    campaign: day.campaign,
    rows: day.rows,
    events: day.events,
    statuses: DEFAULT_STATUSES,
    noteWords: strings.notes,
    words: strings.journal,
    format: FORMAT,
  };
  const lines = journalLines(input);
  return journalSheet(input)
    .slice(1)
    .filter((_, i) => lines[i]?.rowId === rowId)
    .map((line) => [line[0], line[3], line[5], line[6], line[7], line[8]]);
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
    // It is no new owner either: the file hasn't caught up with the door.
    const parsed = parseFixture('public/cases.kmz');
    const again = reimport(parsed, after, NOW);
    expect(again.merge.newOwners).toEqual([]);
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

describe('who is a new owner', () => {
  const roles = { firstName: 'PRENOM', lastName: 'NOM', company: 'Propriétaire' } as const;
  const owner = (PRENOM: string, NOM: string, company = '') =>
    readerFor({ PRENOM, NOM, Propriétaire: company }, roles);

  it('has another first name and another last name (Alex, 2026-10-06)', () => {
    expect(isNewOwner(owner('Marie', 'Trempette'), owner('Rosalie', 'Frite'))).toBe(true);
    // Remarried, or back to her maiden name: the same person.
    expect(isNewOwner(owner('Anne', 'Frite'), owner('Anne', 'Poutini'))).toBe(false);
    expect(isNewOwner(owner('Marie', 'Trempette'), owner('Alain', 'Trempette'))).toBe(false);
    // A slip of one letter, and accents or case, are the same name.
    expect(isNewOwner(owner('Marie', 'Trempete'), owner('Maria', 'Trempette'))).toBe(false);
    expect(isNewOwner(owner('Hélène', 'GRAINS'), owner('helene', 'Grains'))).toBe(false);
  });

  it('decides by the last name without a first name, and by the name for a company', () => {
    expect(isNewOwner(owner('', 'Trempette'), owner('', 'Frite'))).toBe(true);
    expect(isNewOwner(owner('', '', 'La Poutinerie'), owner('', '', 'Cantine Patou'))).toBe(true);
    expect(isNewOwner(owner('', '', 'La Poutinerie'), owner('', '', 'la poutinerie'))).toBe(false);
    expect(isNewOwner(owner('Marie', 'Trempette'), owner('', '', 'La Poutinerie'))).toBe(true);
  });

  it('is nobody new when no one was named, or when the file names no one', () => {
    expect(isNewOwner(owner('', ''), owner('Rosalie', 'Frite'))).toBe(false);
    expect(isNewOwner(owner('Marie', 'Trempette'), owner('', ''))).toBe(false);
  });
});

describe('the visit of the owner before', () => {
  const given = { statusId: 'given', visitDate: '2026-09-25T14:32:00-04:00' };
  const words = strings.previousInfo;

  it('is a visit from before today, or a status without one; a visit today is the new owner’s', () => {
    expect(visitWasBefore(given, DEFAULT_STATUSES, '2026-09-26')).toBe(true);
    expect(visitWasBefore(given, DEFAULT_STATUSES, '2026-09-25')).toBe(false);
    const atDoor = { statusId: 'at-door', visitDate: '' };
    expect(visitWasBefore(atDoor, DEFAULT_STATUSES, '2026-09-26')).toBe(true);
    const toVisit = { statusId: 'to-visit', visitDate: '' };
    expect(visitWasBefore(toVisit, DEFAULT_STATUSES, '2026-09-26')).toBe(false);
  });

  it('reads "Given 25.09.2026", a date the client typed as typed, nothing at To visit', () => {
    expect(previousVisit(given, DEFAULT_STATUSES, words, FORMAT)).toBe('Given 25.09.2026');
    const typed = { statusId: 'given', visitDate: '14 juillet' };
    expect(previousVisit(typed, DEFAULT_STATUSES, words, FORMAT)).toBe('Given 14 juillet');
    const atDoor = { statusId: 'at-door', visitDate: '' };
    expect(previousVisit(atDoor, DEFAULT_STATUSES, words, FORMAT)).toBe('At door');
    const toVisit = { statusId: 'to-visit', visitDate: '' };
    expect(previousVisit(toVisit, DEFAULT_STATUSES, words, FORMAT)).toBe('');
  });
});

describe('New owner and the visit', () => {
  it('at the door, a visit from another day goes with the owner before, and the row starts over', async () => {
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
      now: '2026-09-25T14:32:00-04:00',
    });
    const before = await loaded(campaignId);
    const row = rowOf(before.rows, 'P1-216B', 'Marie');
    const visit = previousVisit(row, DEFAULT_STATUSES, strings.previousInfo, FORMAT);
    const to = startStatus(DEFAULT_STATUSES);
    await editFields(store(), {
      ...house,
      eventId: 'e2-owner',
      now: at('15:00'),
      target: 'house',
      writes: newOwnerWrites(before.campaign, row, { PRENOM: 'Rosalie', NOM: 'Frite' }, visit),
      newOwners: [{ rowIds: [marie.rowId], previous: 'Marie Trempette', next: 'Rosalie Frite' }],
      startOver: {
        statusId: to.id,
        packageStatusText: to.packageStatusText,
        rowIds: [marie.rowId],
      },
    });

    const after = await loaded(campaignId);
    const rosalie = after.rows.find((candidate) => candidate.rowId === marie.rowId);
    if (!rosalie) throw new Error('No row');
    expect(rosalie).toMatchObject({ statusId: 'to-visit', visitDate: '' });
    expect(currentValue(rosalie, PREVIOUS_INFO)).toBe(
      'Marie Trempette, 450 555-0100, 514 555-0199, Given 25.09.2026 (until 26.09.2026)',
    );
    // Alain, on the same parcel at the house, keeps his visit.
    expect(rowOf(after.rows, 'P1-216B', 'Alain').statusId).toBe('given');
    expectReplayed(after);
    expect(journalOf(after, marie.rowId).filter((line) => line[3] === 'Status')).toEqual([
      ['26.09.2026', 'Rosalie Frite', 'New owner', 'Status', 'Given', 'To visit'],
    ]);

    // Undo: Marie, Given on 25.09, as before.
    await undo(store(), {
      campaignId,
      undoneEventId: 'e2-owner',
      eventId: 'e3-undo',
      now: at('15:01'),
    });
    const undone = await loaded(campaignId);
    expect(undone.rows.find((candidate) => candidate.rowId === marie.rowId)).toMatchObject({
      statusId: 'given',
      visitDate: '2026-09-25T14:32:00-04:00',
    });
    expectReplayed(undone);
  });

  it('a client’s file naming someone else starts the row over, the owner before in Previous info', async () => {
    db = freshDb();
    const plan = await casesCampaign(store());
    const campaignId = plan.campaign.id;
    const start = await loaded(campaignId);
    const marie = rowOf(start.rows, 'P1-216B', 'Marie');
    const sylvie = rowOf(start.rows, 'P1-220', 'Sylvie');
    await markHouse(store(), {
      campaignId,
      houseKey: marie.houseKey,
      statusId: 'given',
      eventId: 'e1-given',
      now: at('14:32'),
    });
    const before = await loaded(campaignId);

    // The client's next file: Rosalie Frite bought Marie's part; Sylvie Grains remarried.
    const file = parseFixture('public/cases.kmz');
    const updated: ParsedFile = {
      ...file,
      rows: file.rows.map((incoming) => {
        if (incoming.parcelIdRaw === 'P1-216B' && incoming.fields.PRENOM === 'Marie') {
          const fields = { PRENOM: 'Rosalie', NOM: 'Frite', CELLULAIRE: '418 555-0150' };
          return { ...incoming, fields: { ...incoming.fields, ...fields } };
        }
        if (incoming.parcelIdRaw === 'P1-220')
          return { ...incoming, fields: { ...incoming.fields, NOM: 'Poutini' } };
        return incoming;
      }),
    };
    const again = reimport(updated, before, '2026-10-06T09:00:00-04:00');
    expect(again.merge.newOwners.map((owner) => [owner.rowId, owner.previous, owner.next])).toEqual(
      [[marie.rowId, 'Marie Trempette', 'Rosalie Frite']],
    );
    expect(again.report.newOwners.map((owner) => [owner.previous, owner.row.owner])).toEqual([
      ['Marie Trempette', 'Rosalie Frite'],
    ]);
    expect(again.report.ownerDetailsChanged.map((row) => row.rowId)).toEqual([sylvie.rowId]);
    // She starts over at the file's status: no disagreement to report on her row.
    const row = again.merge.rows.find((candidate) => candidate.rowId === marie.rowId);
    expect(row).toMatchObject({
      statusId: 'to-visit',
      visitDate: '',
      origin: null,
      touched: { appFields: [], moved: false },
    });
    const previous =
      'Marie Trempette, 450 555-0100, 514 555-0199, Given 26.09.2026 (until 06.10.2026)';
    expect(row?.edits).toEqual({ [PREVIOUS_INFO]: previous });
    expect(again.report.conflicts.filter((conflict) => conflict.rowId === marie.rowId)).toEqual([]);
    expect(again.campaign.columnOrder.at(-1)).toBe(PREVIOUS_INFO);
    // Alain stays Given, his visit his own.
    const alain = rowOf(before.rows, 'P1-216B', 'Alain');
    expect(again.merge.rows.find((r) => r.rowId === alain.rowId)?.statusId).toBe('given');

    // Saved, it replays the same, and the Journal names the owner of the time.
    await commitImport(store(), again, 'import-2', '2026-10-06T09:00:00-04:00');
    const saved = await loaded(campaignId);
    expectReplayed(saved);
    expect(journalOf(saved, marie.rowId)).toEqual([
      ['26.09.2026', 'Marie Trempette', 'Status', 'Given', '', 'Given'],
      ['06.10.2026', 'Rosalie Frite', 'New owner', 'PRENOM', 'Marie', 'Rosalie'],
      ['06.10.2026', 'Rosalie Frite', 'New owner', 'NOM', 'Trempette', 'Frite'],
      ['06.10.2026', 'Rosalie Frite', 'New owner', 'CELLULAIRE', '514 555-0199', '418 555-0150'],
      ['06.10.2026', 'Rosalie Frite', 'New owner', PREVIOUS_INFO, '', previous],
      ['06.10.2026', 'Rosalie Frite', 'New owner', 'Status', 'Given', 'To visit'],
    ]);
  });
});

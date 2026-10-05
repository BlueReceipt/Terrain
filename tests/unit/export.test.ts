import 'fake-indexeddb/auto';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerrainDb } from '../../src/data/db.ts';
import {
  addNote,
  campaignEvents,
  commitImport,
  editFields,
  loadCampaign,
  logCall,
  markHouse,
  moveHouse,
  undo,
} from '../../src/data/repo.ts';
import { APP_ROLES } from '../../src/domain/columns.ts';
import { activeDays, dayLog, dayLogText } from '../../src/domain/daylog.ts';
import type { TerrainEvent } from '../../src/domain/events.ts';
import { journalLines, journalSheet, type JournalInput } from '../../src/domain/export/journal.ts';
import { layerRows, myMapsCsv, positionedBy, unplaceable } from '../../src/domain/export/mymaps.ts';
import { exportFileName } from '../../src/domain/export/names.ts';
import { parcelsSheet, type ExportInput } from '../../src/domain/export/sheet.ts';
import { workbookBytes } from '../../src/domain/export/xlsx.ts';
import { myMapsValue } from '../../src/domain/identity.ts';
import { notesByRow, ownNoteTexts, withoutOwnNotes } from '../../src/domain/notes.ts';
import { DEFAULT_STATUSES } from '../../src/domain/statuses.ts';
import { parseTabular } from '../../src/domain/tabular.ts';
import type { Campaign, ParsedFile, Row } from '../../src/domain/types.ts';
import { strings } from '../../src/ui/strings.ts';
import { casesCampaign, freshDb, rowOf } from '../support/campaign.ts';
import { importInto, parseFixture } from '../support/import.ts';

// BUILD_SPEC Phase 5 gate. One day at 123 rue Saint-Paul (Alain and Marie Trempette on P1-216B,
// Alain on P1-217A), whose lot reaches Luc Trempette at 12 chemin du Lac.

let db: TerrainDb;
afterEach(async () => {
  db.close();
  await db.delete();
});

const at = (time: string) => `2026-09-26T${time}:00-04:00`;
const HERE = { lat: 45.26455, lng: -73.61 };

interface Day {
  campaign: Campaign;
  rows: Row[];
  events: TerrainEvent[];
  parsed: ParsedFile;
}

async function loaded(campaignId: string) {
  const campaign = await loadCampaign(db, campaignId);
  if (!campaign) throw new Error('No campaign');
  return {
    campaign: campaign.campaign,
    rows: campaign.rows,
    events: await campaignEvents(db, campaignId),
  };
}

/** The field day: Edit info, Given, a call, a note, the house pinned at the door, a mis-tap undone. */
async function fieldDay(): Promise<Day> {
  db = freshDb();
  const plan = await casesCampaign(db);
  const campaignId = plan.campaign.id;
  const before = (await loaded(campaignId)).rows;
  const alain = rowOf(before, 'P1-216B', 'Alain');
  const marie = rowOf(before, 'P1-216B', 'Marie');
  const alain217 = rowOf(before, 'P1-217A', 'Alain');
  const luc = rowOf(before, 'P1-216B', 'Luc');
  const house = { campaignId, houseKey: alain.houseKey };
  await editFields(db, {
    ...house,
    eventId: 'e1-edit',
    now: at('14:28'),
    target: 'house',
    writes: [
      { rowIds: [alain.rowId, alain217.rowId], column: 'TEL_RES', value: '450 555-0111' },
      { rowIds: [marie.rowId], column: 'CELLULAIRE', value: '514 555-0100' },
    ],
  });
  await markHouse(db, { ...house, statusId: 'given', eventId: 'e2-given', now: at('14:32') });
  await logCall(db, {
    ...house,
    eventId: 'e3-call',
    now: at('14:35'),
    // Marie's cell as Alex corrected it at 14:28.
    number: '514 555-0100',
    outcome: 'Voicemail',
    callDate: at('14:34'),
    scope: 'number',
  });
  await addNote(db, {
    ...house,
    eventId: 'e4-note',
    now: at('14:40'),
    rowId: null,
    text: 'Cantine Alain, confirmer avec Alain',
  });
  await moveHouse(db, {
    ...house,
    eventId: 'e5-move',
    now: at('14:45'),
    position: HERE,
    accuracyM: 8,
  });
  await markHouse(db, {
    campaignId,
    houseKey: luc.houseKey,
    statusId: 'at-door',
    eventId: 'e6-mistap',
    now: at('14:50'),
  });
  await undo(db, { campaignId, undoneEventId: 'e6-mistap', eventId: 'e7-undo', now: at('14:51') });
  return { ...(await loaded(campaignId)), parsed: plan.parsed };
}

function exportInput(day: Pick<Day, 'campaign' | 'rows' | 'events'>): ExportInput {
  return {
    campaign: day.campaign,
    rows: day.rows,
    events: day.events,
    words: strings.notes,
    appHeaders: strings.exports.appHeaders,
    format: 'DD.MM.YYYY HH:mm',
    notesMode: 'joined',
  };
}

function journalInput(day: Pick<Day, 'campaign' | 'rows' | 'events'>): JournalInput {
  return {
    campaign: day.campaign,
    rows: day.rows,
    events: day.events,
    statuses: DEFAULT_STATUSES,
    noteWords: strings.notes,
    words: strings.journal,
    format: 'DD.MM.YYYY HH:mm',
  };
}

/** A sheet of the workbook as text cells, the way Excel shows them. */
function readSheet(bytes: Uint8Array, name: string): string[][] {
  const book = XLSX.read(bytes, { type: 'array' });
  const sheet = book.Sheets[name];
  if (!sheet) throw new Error(`No sheet ${name}`);
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
}

describe('Excel for the client (§5.8)', () => {
  it('round trip: headers, columns and rows as imported; current values; untouched cells unchanged', async () => {
    const day = await fieldDay();
    const parcels = parcelsSheet(exportInput(day));
    const bytes = workbookBytes([
      { name: 'Parcels', lines: parcels },
      { name: 'Journal', lines: journalSheet(journalInput(day)) },
    ]);
    // What Excel reads back is exactly what Terrain wrote, every cell as text.
    expect(readSheet(bytes, 'Parcels')).toEqual(parcels);

    const [header = [], ...lines] = parcels;
    expect(header).toEqual(['Parcel ID', ...day.parsed.columns]);
    expect(lines.map((line) => line[0])).toEqual(day.parsed.rows.map((row) => row.parcelIdRaw));
    const cell = (line: readonly string[], column: string) => line[header.indexOf(column)] ?? '';
    const lineOf = (row: Row) => lines[day.rows.findIndex((r) => r.rowId === row.rowId)] ?? [];
    const alain = lineOf(rowOf(day.rows, 'P1-216B', 'Alain'));
    const marie = lineOf(rowOf(day.rows, 'P1-216B', 'Marie'));
    const alain217 = lineOf(rowOf(day.rows, 'P1-217A', 'Alain'));
    const luc = lineOf(rowOf(day.rows, 'P1-216B', 'Luc'));

    // Rows at one house carry the same status, Visit date and house notes, each on its own line.
    for (const line of [alain, marie, alain217]) {
      expect(cell(line, 'Package status')).toBe('Given');
      expect(cell(line, 'Visit date')).toBe('26.09.2026 14:32');
      expect(cell(line, 'Notes')).toBe('26.09.2026 14:40 - Cantine Alain, confirmer avec Alain');
    }
    // Corrections, on the owner they belong to.
    expect([alain, alain217, marie].map((line) => cell(line, 'TEL_RES'))).toEqual([
      '450 555-0111',
      '450 555-0111',
      '450 555-0100',
    ]);
    expect(cell(marie, 'CELLULAIRE')).toBe('514 555-0100');
    expect([cell(marie, 'Call date'), cell(marie, 'call result')]).toEqual([
      '26.09.2026 14:34',
      'Voicemail',
    ]);
    // Luc, closed from the lot: Given, the visit's time, and the lot note saying with whom.
    expect(cell(luc, 'Package status')).toBe('Given');
    expect(cell(luc, 'Visit date')).toBe('26.09.2026 14:32');
    expect(cell(luc, 'Notes')).toBe(
      'Given with Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 26.09.2026 14:32',
    );

    // Every other cell is the imported value.
    const appColumns = new Set(APP_ROLES.map((role) => day.campaign.roles[role]));
    day.parsed.rows.forEach((incoming, i) => {
      const row = day.rows[i];
      const line = lines[i] ?? [];
      if (!row) throw new Error('Missing row');
      for (const column of day.parsed.columns) {
        if (appColumns.has(column) || column in row.edits) continue;
        expect(cell(line, column), `${incoming.parcelIdRaw} ${column}`).toBe(
          incoming.fields[column] ?? '',
        );
      }
    });
  });

  it('adds the columns of Terrain the client’s file lacks at the end, so no work is lost', async () => {
    const day = await fieldDay();
    const roles = Object.fromEntries(
      Object.entries(day.campaign.roles).filter(([role]) => role !== 'callResult'),
    );
    const campaign = {
      ...day.campaign,
      roles,
      columnOrder: day.campaign.columnOrder.filter((column) => column !== 'call result'),
    };
    const [header = [], ...lines] = parcelsSheet(exportInput({ ...day, campaign }));
    expect(header.at(-1)).toBe('call result');
    const marie = day.rows.findIndex(
      (row) => row.rowId === rowOf(day.rows, 'P1-216B', 'Marie').rowId,
    );
    expect(lines[marie]?.at(-1)).toBe('Voicemail');
  });

  it('Journal: one line per affected row for every action and every lot spread, undo included', async () => {
    const day = await fieldDay();
    const lines = journalLines(journalInput(day));
    const of = (eventId: string) => lines.filter((line) => line.eventId === eventId);
    const name = (rowId: string) => {
      const row = day.rows.find((candidate) => candidate.rowId === rowId);
      return `${row?.parcelIdRaw ?? ''} ${row?.sourceFields.PRENOM ?? ''}`;
    };
    const summary = (eventId: string) =>
      of(eventId).map((line) => [
        name(line.rowId),
        line.action,
        line.detail,
        line.previous,
        line.next,
      ]);

    expect(summary('e1-edit')).toEqual([
      ['P1-216B Alain', 'fieldEdited', 'TEL_RES', '450 555-0100', '450 555-0111'],
      ['P1-216B Marie', 'fieldEdited', 'CELLULAIRE', '514 555-0199', '514 555-0100'],
      ['P1-217A Alain', 'fieldEdited', 'TEL_RES', '450 555-0100', '450 555-0111'],
    ]);
    const note =
      'Given with Alain Trempette / Marie Trempette at 123, rue Saint-Paul, 26.09.2026 14:32';
    expect(summary('e2-given')).toEqual([
      ['P1-216B Alain', 'status', 'Given', '', 'Given'],
      ['P1-216B Marie', 'status', 'Given', '', 'Given'],
      ['P1-217A Alain', 'status', 'Given', '', 'Given'],
      ['P1-216B Luc', 'statusViaLot', note, '', 'Given'],
    ]);
    expect(summary('e3-call')).toEqual([
      ['P1-216B Marie', 'call', '514 555-0100', '', 'Voicemail'],
    ]);
    expect(summary('e4-note').map((line) => line[0])).toEqual([
      'P1-216B Alain',
      'P1-216B Marie',
      'P1-217A Alain',
    ]);
    expect(summary('e5-move')).toHaveLength(3);
    expect(of('e5-move')[0]).toMatchObject({
      action: 'pinMoved',
      detail: 'GPS, accurate to 8 m',
      next: '45.264550, -73.610000',
    });
    // The mis-tap stays in the record, then its Undo puts Luc back.
    expect(summary('e6-mistap')).toEqual([
      ['P1-216B Luc', 'status', 'At door', 'Given', 'At door'],
    ]);
    expect(summary('e7-undo')).toEqual([
      ['P1-216B Luc', 'undo', 'Status: At door', 'At door', 'Given'],
    ]);
    // The import that started the campaign changed nothing: no line.
    expect(lines.filter((line) => line.action === 'importUpdate')).toEqual([]);

    const sheet = journalSheet(journalInput(day));
    expect(sheet[0]).toEqual([...strings.journal.headers]);
    expect(sheet).toHaveLength(lines.length + 1);
    expect(sheet[1]).toEqual([
      '26.09.2026',
      '14:28',
      'P1-216B',
      'Alain Trempette',
      '123, rue Saint-Paul',
      'Field edited',
      'TEL_RES',
      '450 555-0100',
      '450 555-0111',
    ]);
  });
});

describe('re-importing after a day in the field (Phase 5 gate)', () => {
  it('the original KMZ keeps every correction and the moved house, and lists each disagreement', async () => {
    const day = await fieldDay();
    const plan = importInto(day.parsed, { ...dayPlan(day) }, day.rows);
    const row = (parcel: string, name: string) => rowOf(plan.merge.rows, parcel, name);
    expect(row('P1-216B', 'Alain').edits).toEqual({ TEL_RES: '450 555-0111' });
    expect(row('P1-216B', 'Marie').edits).toEqual({ CELLULAIRE: '514 555-0100' });
    for (const [parcel, name] of [
      ['P1-216B', 'Alain'],
      ['P1-216B', 'Marie'],
      ['P1-217A', 'Alain'],
    ] as const) {
      expect(row(parcel, name).position).toEqual(HERE);
      expect(row(parcel, name).statusId).toBe('given');
    }
    const conflicts = plan.merge.conflicts.map((conflict) => {
      const of = plan.merge.rows.find((candidate) => candidate.rowId === conflict.rowId);
      return `${of?.parcelIdRaw ?? ''} ${of?.sourceFields.PRENOM ?? ''} ${conflict.column}`;
    });
    expect(conflicts).toEqual(
      expect.arrayContaining([
        'P1-216B Alain TEL_RES',
        'P1-217A Alain TEL_RES',
        'P1-216B Marie CELLULAIRE',
        'P1-216B Alain Position',
        'P1-216B Marie Position',
        'P1-217A Alain Position',
        'P1-216B Luc Package status',
      ]),
    );
    expect(plan.merge.changes).toEqual([]);
  });

  it('previous values: a new name and phone from the client, and a field both changed, keep all three values', async () => {
    const day = await fieldDay();
    const incoming: ParsedFile = {
      ...day.parsed,
      rows: day.parsed.rows.map((row) => {
        if (row.parcelIdRaw === 'P1-216B' && row.fields.PRENOM === 'Luc')
          return {
            ...row,
            fields: { ...row.fields, PRENOM: 'Lucien', CELLULAIRE: '450 555-0178' },
          };
        if (row.fields.PRENOM === 'Alain')
          return { ...row, fields: { ...row.fields, TEL_RES: '450 555-0122' } };
        return row;
      }),
    };
    const plan = importInto(incoming, dayPlan(day), day.rows);
    await commitImport(db, plan, 'e8-import', at('16:00'));
    const after = await loaded(day.campaign.id);

    const lucien = rowOf(after.rows, 'P1-216B', 'Lucien');
    expect(plan.merge.ownerDetailsChanged).toEqual([lucien.rowId]);
    expect(lucien.sourceFields.CELLULAIRE).toBe('450 555-0178');
    const alain = rowOf(after.rows, 'P1-216B', 'Alain');
    expect(alain.edits).toEqual({ TEL_RES: '450 555-0111' });
    expect(plan.merge.conflicts).toEqual(
      expect.arrayContaining([
        { rowId: alain.rowId, column: 'TEL_RES', local: '450 555-0111', incoming: '450 555-0122' },
      ]),
    );

    const lines = journalLines(journalInput(after));
    const of = (rowId: string, action: string) =>
      lines
        .filter((line) => line.rowId === rowId && line.action === action)
        .map((line) => [line.detail, line.previous, line.next]);
    expect(of(lucien.rowId, 'importUpdate')).toEqual([
      ['PRENOM', 'Luc', 'Lucien'],
      ['CELLULAIRE', '450 555-0177', '450 555-0178'],
    ]);
    // The imported value, Alex's correction and the client's new value, all in the Journal.
    expect(of(alain.rowId, 'fieldEdited')).toEqual([['TEL_RES', '450 555-0100', '450 555-0111']]);
    expect(of(alain.rowId, 'importUpdate')).toEqual([['TEL_RES', '450 555-0100', '450 555-0122']]);
  });

  it('an export coming back (My Maps after Replace all items) is no news and shows each note once', async () => {
    const day = await fieldDay();
    const input = exportInput(day);
    const [header = [], ...lines] = parcelsSheet(input);
    const roles = day.campaign.roles;
    // The KMZ My Maps gives after Replace all items: Terrain's values in every column, its own
    // columns added, each pin where the export put it.
    const back: ParsedFile = {
      ...day.parsed,
      columns: [...day.parsed.columns, 'Parcel ID', 'Latitude', 'Longitude', 'Location'],
      rows: day.parsed.rows.map((incoming, i) => {
        const row = day.rows[i];
        const line = lines[i] ?? [];
        if (!row) throw new Error('Missing row');
        const fields = Object.fromEntries(
          day.parsed.columns.map((column) => [column, line[header.indexOf(column)] ?? '']),
        );
        return {
          ...incoming,
          fields: {
            ...fields,
            'Parcel ID': row.parcelIdRaw,
            Latitude: myMapsValue(row, 'latitude', roles),
            Longitude: myMapsValue(row, 'longitude', roles),
            Location: myMapsValue(row, 'location', roles),
          },
          position: row.position,
          // Styled by Package status in My Maps, with the status colors.
          pinColor: DEFAULT_STATUSES.find((status) => status.id === row.statusId)?.color ?? null,
        };
      }),
    };
    const plan = importInto(back, dayPlan(day), day.rows, ownNoteTexts(day.events, strings.notes));
    expect(plan.merge.conflicts).toEqual([]);
    // Only the corrections the file now carries, absorbed (§6.4): nothing else changed.
    expect(new Set(plan.merge.changes.map((change) => change.column))).toEqual(
      new Set(['TEL_RES', 'CELLULAIRE']),
    );
    expect(plan.merge.absorbed).toHaveLength(3);
    // Terrain's notes in the Notes cells are recognized: every note shows once.
    const notes = notesByRow(plan.merge.rows, day.events, strings.notes, 'DD.MM.YYYY HH:mm');
    const luc = rowOf(plan.merge.rows, 'P1-216B', 'Luc');
    const marie = rowOf(plan.merge.rows, 'P1-216B', 'Marie');
    expect(notes.get(luc.rowId)?.map((note) => note.kind)).toEqual(['lot']);
    expect(notes.get(marie.rowId)?.map((note) => note.kind)).toEqual(['house']);
    // The next export is the same file.
    expect(parcelsSheet({ ...input, rows: plan.merge.rows })).toEqual(parcelsSheet(input));
  });
});

/** The day's campaign as an earlier import plan, for importInto. */
function dayPlan(day: Day) {
  return { ...importInto(day.parsed), campaign: day.campaign };
}

describe('My Maps update (§5.8)', () => {
  it('one CSV per layer: Parcel ID, the columns, Latitude, Longitude and Location, UTF-8 with BOM', async () => {
    const day = await fieldDay();
    const layer = day.campaign.layers[0] ?? '';
    const csv = myMapsCsv(exportInput(day), layer);
    expect(csv.startsWith('\uFEFFParcel ID,')).toBe(true);
    expect(csv.split('\r\n')[0]?.endsWith(',Latitude,Longitude,Location')).toBe(true);

    // Terrain's own reader takes it back: same rows, accents intact, the moved house where it is now.
    const parsed = parseTabular(new TextEncoder().encode(csv), 'layer.csv');
    const rows = layerRows(day.rows, layer);
    expect(parsed.rows.map((row) => row.parcelIdRaw)).toEqual(rows.map((row) => row.parcelIdRaw));
    expect(parsed.rows.map((row) => row.fields.MUNICIPALITE)).toEqual(
      rows.map((row) => row.sourceFields.MUNICIPALITE),
    );
    const alain = rows.findIndex((row) => row.rowId === rowOf(day.rows, 'P1-216B', 'Alain').rowId);
    expect(parsed.rows[alain]?.position).toEqual(HERE);
    expect(parsed.rows[alain]?.fields.TEL_RES).toBe('450 555-0111');
    expect(parsed.rows[alain]?.fields['Package status']).toBe('Given');
    // A pin My Maps placed from its address has that address as its Location.
    const unplaced = rows.findIndex((row) => !row.position);
    if (unplaced >= 0) {
      expect(parsed.rows[unplaced]?.fields.Location).toBe(rows[unplaced]?.addressText ?? '');
      expect(positionedBy(day.rows, layer)).toBe('location');
    }
  });

  it('quotes commas, quotes and line breaks', () => {
    const rows = importInto(parseFixture('public/cases.kmz')).merge.rows;
    const first = rows[0];
    if (!first) throw new Error('No row');
    const tricky: Row = {
      ...first,
      sourceFields: { ...first.sourceFields, Notes: 'Chien, "méchant"\nSonner deux fois' },
      importedNotes: 'Chien, "méchant"\nSonner deux fois',
    };
    const plan = importInto(parseFixture('public/cases.kmz'));
    const csv = myMapsCsv(
      exportInput({ campaign: plan.campaign, rows: [tricky], events: [] }),
      tricky.layer,
    );
    expect(csv).toContain('"Chien, ""méchant""\nSonner deux fois"');
  });

  it('names files Terrain_<campaign>_<layer>_<date>, safe on Windows and Android', () => {
    expect(exportFileName(['Poutine sample'], '2026-10-01', 'xlsx')).toBe(
      'Terrain_Poutine sample_2026-10-01.xlsx',
    );
    expect(exportFileName(['Poutine sample', 'Zone 3 / Nord: est'], '2026-10-01', 'csv')).toBe(
      'Terrain_Poutine sample_Zone 3 - Nord- est_2026-10-01.csv',
    );
  });
});

describe('Terrain’s notes coming back in a Notes cell', () => {
  const own = [
    '26.09.2026 14:40 - Cantine Alain',
    'Given with Luc Trempette at 12, chemin du Lac, 26.09.2026 14:32',
  ];

  it('leaves what the client wrote and removes the notes Terrain wrote', () => {
    expect(withoutOwnNotes('Propriétaire unique\n26.09.2026 14:40 - Cantine Alain', own)).toBe(
      'Propriétaire unique',
    );
    expect(withoutOwnNotes('26.09.2026 14:40 - Cantine Alain', own)).toBe('');
    // A cell that lost its line breaks on the way.
    expect(withoutOwnNotes('Propriétaire unique 26.09.2026 14:40 - Cantine Alain', own)).toBe(
      'Propriétaire unique',
    );
  });

  it('changes nothing in a cell holding none of them', () => {
    const cell = '  Rappeler  en mars\n\nCédule: avril ';
    expect(withoutOwnNotes(cell, own)).toBe(cell);
    expect(withoutOwnNotes(cell, [])).toBe(cell);
  });
});

describe('day log (§5.7)', () => {
  it('counts the day and names each action by house, the undone mis-tap left out', async () => {
    const day = await fieldDay();
    const log = dayLog({
      day: '2026-09-26',
      campaign: day.campaign,
      rows: day.rows,
      events: day.events,
      statuses: DEFAULT_STATUSES,
      words: strings.dayLog.words,
    });
    expect(
      log.counts.map(({ statusId, direct, viaLot }) => ({ statusId, direct, viaLot })),
    ).toEqual([{ statusId: 'given', direct: 3, viaLot: 1 }]);
    expect([log.corrections, log.calls, log.notes]).toEqual([4, 1, 1]);
    expect(dayLogText(log, 'Poutine sample', 'DD.MM.YYYY HH:mm', strings.dayLog.words)).toBe(
      [
        'Terrain, Poutine sample, 26.09.2026',
        'Given: 3 rows (+1 via lot) · Corrections: 4 · Calls: 1 · Notes: 1',
        '',
        '14:28  123, rue Saint-Paul  info updated: TEL_RES (Alain Trempette), CELLULAIRE (Marie Trempette)',
        '14:32  123, rue Saint-Paul  Given',
        '       P1-216B (2 rows), P1-217A',
        '       also closed 12, chemin du Lac (Luc Trempette, P1-216B)',
        '14:35  123, rue Saint-Paul  call 514 555-0100: Voicemail (Marie Trempette)',
        '14:40  123, rue Saint-Paul  note: Cantine Alain, confirmer avec Alain',
        '14:45  123, rue Saint-Paul  pinned where you were (8 m)',
      ].join('\n'),
    );
    const alain = rowOf(day.rows, 'P1-216B', 'Alain');
    expect(log.lines.every((line) => line.houseKey === alain.houseKey)).toBe(true);
    expect(activeDays(day.events)).toEqual(['2026-09-26']);

    const quiet = dayLog({
      day: '2026-09-27',
      campaign: day.campaign,
      rows: day.rows,
      events: day.events,
      statuses: DEFAULT_STATUSES,
      words: strings.dayLog.words,
    });
    expect(dayLogText(quiet, 'Poutine sample', 'DD.MM.YYYY HH:mm', strings.dayLog.words)).toBe(
      'Terrain, Poutine sample, 27.09.2026\nNothing recorded this day.',
    );
  });
});

describe('a real My Maps export: the poutine sample', () => {
  it('exports every row of every layer and every column, Excel and My Maps alike', () => {
    const plan = importInto(parseFixture('public/poutine-autour-du-quebec.kml'));
    const rows = plan.merge.rows;
    const input = exportInput({ campaign: plan.campaign, rows, events: [] });
    const parcels = parcelsSheet(input);
    expect(parcels).toHaveLength(rows.length + 1);
    expect(parcels[0]).toEqual(['Parcel ID', ...plan.parsed.columns]);
    expect(readSheet(workbookBytes([{ name: 'Parcels', lines: parcels }]), 'Parcels')).toEqual(
      parcels,
    );

    const layers = plan.campaign.layers.filter((layer) => layerRows(rows, layer).length > 0);
    let total = 0;
    let unplaced = 0;
    for (const layer of layers) {
      const book = XLSX.read(myMapsCsv(input, layer).slice(1), { type: 'string', raw: true });
      const sheet = book.Sheets[book.SheetNames[0] ?? ''];
      if (!sheet) throw new Error('No sheet');
      const lines = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: true, defval: '' });
      // Latitude and Longitude are added at the end, unless the campaign already has them.
      expect(lines[0]?.at(-1)).toBe('Location');
      expect(lines[0]).toEqual(expect.arrayContaining(['Latitude', 'Longitude']));
      // Every pin can be placed, by its coordinates or by the address My Maps placed it from,
      // except rows with neither, which the export panel names.
      const blank = lines.slice(1).filter((line) => String(line.at(-1)).trim() === '').length;
      expect(blank).toBe(unplaceable(rows, layer, plan.campaign.roles).length);
      unplaced += blank;
      total += lines.length - 1;
    }
    expect(total).toBe(rows.length);
    // My Maps placed all 124 pins from their address and exported no coordinates: each one goes
    // back to My Maps by that address.
    expect(rows).toHaveLength(124);
    expect(rows.filter((row) => !row.position && row.addressText)).toHaveLength(124);
    expect(unplaced).toBe(0);
  }, 60_000);
});

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredEvent, TerrainDb } from '../../src/data/db.ts';
import {
  addNote,
  campaignEvents,
  commitImport,
  deleteNote,
  editFields,
  loadCampaign,
  logCall,
  markHouse,
  markRow,
  moveHouse,
  resolveCall,
  startCall,
  undo,
} from '../../src/data/repo.ts';
import { editLayout } from '../../src/domain/editLayout.ts';
import { foldStates, stateOf, undoable, undoneIds } from '../../src/domain/events.ts';
import { initialColorMap, planImport } from '../../src/domain/importPlan.ts';
import { applyIdentity } from '../../src/domain/rows.ts';
import { DEFAULT_STATUSES } from '../../src/domain/statuses.ts';
import type { Campaign, Row } from '../../src/domain/types.ts';
import { freshDb } from '../support/campaign.ts';
import { counter, parseFixture } from '../support/import.ts';

/** Repeatable randomness (mulberry32): a failing seed replays the same sequence. */
function seeded(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) throw new Error('Nothing to pick from');
    return item;
  };
  return { next, pick };
}

/** A minute later at every step. */
function timeOf(step: number): string {
  const day = 26 + Math.floor(step / 600);
  const minutes = 8 * 60 + (step % 600);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `2026-09-${String(day)}T${hh}:${mm}:00-04:00`;
}

const VALUES: Record<string, readonly string[]> = {
  ADRESSE: ['123 rue St-Paul', '12, chemin du Lac', '77 route Centrale', ''],
  CODE_POSTAL: ['G0R 4E0', 'J0J 1K0', ''],
  TEL_RES: ['450 555-0100', '450 555-0111', ''],
  NUM_LOT: ['1 234 500', '1 234 501', '1 234 599', ''],
  PRENOM: ['Alain', 'Marc', ''],
  // cases-renamed.kmz corrects "Trempoté" to "Trempette": a re-import can absorb that correction.
  NOM: ['Trempette', 'Trempoté'],
  CELLULAIRE: ['514 555-0199', '450 555-0177', '450 555-0123'],
  'Contact person': ['Locataire', ''],
};

let db: TerrainDb;
afterEach(async () => {
  db.close();
  await db.delete();
});

async function importFile(
  store: TerrainDb,
  file: string,
  campaign: Campaign | null,
  rows: Row[],
  lotColumn: string | null,
  now: string,
  ids: () => string,
) {
  const parsed = parseFixture(file);
  const plan = planImport({
    parsed,
    campaign,
    existingRows: rows,
    statuses: DEFAULT_STATUSES,
    roles: { ...parsed.roles, ...campaign?.roles },
    colorMap: initialColorMap(parsed, DEFAULT_STATUSES, campaign?.colorMap).colorMap,
    lotColumn,
    now,
    newId: ids,
  });
  await commitImport(store, plan, ids(), now);
  return plan.campaign.id;
}

/** Stored rows equal the replay of the campaign's events, and houses and lots match the current values. */
async function expectConsistent(store: TerrainDb, campaignId: string, what: string) {
  const loaded = await loadCampaign(store, campaignId);
  if (!loaded) throw new Error('No campaign');
  const events = await campaignEvents(store, campaignId);
  const folded = foldStates(loaded.rows, events, loaded.campaign.roles);
  for (const row of loaded.rows) {
    expect(stateOf(row), `${what}: row ${row.rowId}`).toEqual(folded.get(row.rowId));
  }
  const regrouped = applyIdentity(loaded.rows, loaded.campaign).rows;
  expect(
    loaded.rows.map((row) => [row.rowId, row.houseKey, row.lotKeys]),
    `${what}: houses and lots`,
  ).toEqual(regrouped.map((row) => [row.rowId, row.houseKey, row.lotKeys]));
}

async function runSequence(seed: number, lotColumn: string | null, steps: number) {
  const random = seeded(seed);
  const ids = counter(`s${String(seed)}-`);
  db = freshDb();
  const campaignId = await importFile(db, 'public/cases.kmz', null, [], lotColumn, timeOf(0), ids);
  const done: string[] = [];

  for (let step = 1; step <= steps; step++) {
    const now = timeOf(step);
    const loaded = await loadCampaign(db, campaignId);
    if (!loaded) throw new Error('No campaign');
    const { campaign, rows } = loaded;
    const houses = [...new Set(rows.map((row) => row.houseKey))];
    const houseKey = random.pick(houses);
    const houseRows = rows.filter((row) => row.houseKey === houseKey);
    const roll = random.next();
    const eventId = ids();
    let what: string;

    if (roll < 0.25) {
      what = 'house tap';
      // Now and then, the status a house already got from its lot: the tap makes it a direct visit.
      const closed = rows.filter((row) => row.origin !== null);
      const again = closed.length > 0 && random.next() < 0.3 ? random.pick(closed) : null;
      await markHouse(db, {
        campaignId,
        houseKey: again?.houseKey ?? houseKey,
        statusId: again?.statusId ?? random.pick(DEFAULT_STATUSES).id,
        eventId,
        now,
      });
    } else if (roll < 0.35) {
      what = 'row tap';
      await markRow(db, {
        campaignId,
        rowId: random.pick(rows).rowId,
        statusId: random.pick(DEFAULT_STATUSES).id,
        eventId,
        now,
      });
    } else if (roll < 0.55 && random.next() < 0.25) {
      what = 'correction';
      // The correction the client's next file brings ("Trempoté" → "Trempette"): a re-import absorbs it.
      const jean = rows.find((row) => row.parcelIdRaw === 'P1-240');
      if (jean) {
        await editFields(db, {
          campaignId,
          houseKey: jean.houseKey,
          target: 'row',
          writes: [
            { rowIds: [jean.rowId], column: 'NOM', value: random.pick(['Trempette', 'Trempoté']) },
          ],
          eventId,
          now,
        });
      }
    } else if (roll < 0.55) {
      what = 'correction';
      const layout = editLayout(houseRows, campaign);
      const fields = [
        ...layout.house,
        ...layout.parcels.flatMap((parcel) => parcel.fields),
        ...layout.people.flatMap((person) => person.fields),
      ].filter((field) => field.column in VALUES);
      const writes = [random.pick(fields), random.pick(fields)].map((field) => ({
        rowIds: field.rowIds,
        column: field.column,
        value: random.pick(VALUES[field.column] ?? ['']),
      }));
      await editFields(db, { campaignId, houseKey, target: 'house', writes, eventId, now });
    } else if (roll < 0.62) {
      what = 'move';
      const placed = rows.filter((row) => row.position);
      const near = random.pick(placed).position;
      const position =
        near && random.next() < 0.5
          ? { lat: near.lat + 0.000001, lng: near.lng }
          : { lat: 45.2 + random.next() * 0.1, lng: -73.6 + random.next() * 0.1 };
      await moveHouse(db, { campaignId, houseKey, position, accuracyM: 8, eventId, now });
    } else if (roll < 0.7) {
      what = 'call';
      await logCall(db, {
        campaignId,
        houseKey,
        number: random.pick(['450 555-0100', '514 555-0199', '450 555-0123', '819 555-0000']),
        outcome: random.pick(['Info good', 'Voicemail']),
        callDate: now,
        scope: random.next() < 0.8 ? 'number' : 'house',
        eventId,
        now,
      });
    } else if (roll < 0.74) {
      what = 'pending call';
      await startCall(db, {
        id: `p-${eventId}`,
        campaignId,
        houseKey,
        number: random.pick(['450 555-0100', '450 555-0177']),
        startedAt: now,
      });
      await resolveCall(db, { pendingId: `p-${eventId}`, outcome: 'No answer', eventId, now });
    } else if (roll < 0.81) {
      what = 'note';
      const one = random.next() < 0.3 ? random.pick(houseRows).rowId : null;
      await addNote(db, {
        campaignId,
        houseKey,
        rowId: one,
        text: `note ${eventId}`,
        eventId,
        now,
      });
    } else if (roll < 0.84) {
      what = 'note deleted';
      const events = await campaignEvents(db, campaignId);
      const undone = undoneIds(events);
      const notes = events.filter((event) => event.type === 'note_added' && !undone.has(event.id));
      if (notes.length > 0)
        await deleteNote(db, { campaignId, noteEventId: random.pick(notes).id, eventId, now });
    } else if (roll < 0.93) {
      what = 'undo';
      const last = undoable(await campaignEvents(db, campaignId));
      if (last) await undo(db, { campaignId, undoneEventId: last.id, eventId, now });
    } else {
      what = 're-import';
      const file = random.pick(['public/cases.kmz', 'public/cases-renamed.kmz']);
      await importFile(db, file, campaign, rows, campaign.lotColumn, now, ids);
    }
    done.push(what);
    await expectConsistent(db, campaignId, `seed ${String(seed)}, step ${String(step)} (${what})`);
    const after = await storedRowsOf(db, campaignId);
    if (after.map((row) => row.houseKey).join() !== rows.map((row) => row.houseKey).join())
      seen.add('houses regrouped');
    if (
      after.map((row) => row.lotKeys.join('+')).join() !==
      rows.map((row) => row.lotKeys.join('+')).join()
    )
      seen.add('lots regrouped');
  }
  for (const event of await campaignEvents(db, campaignId))
    for (const kind of kindsOf(event)) seen.add(kind);
  return done;
}

/** What the sequences went through, so a lucky run can't hide an untested path. */
const seen = new Set<string>();

function kindsOf(event: StoredEvent): string[] {
  switch (event.type) {
    case 'status_set': {
      const tap = event.payload;
      return [
        tap.target === 'house' ? 'house tap' : 'row tap',
        ...(tap.lotAffected.some((entry) => entry.statusChanged) ? ['lot closed'] : []),
        ...(tap.lot?.mode === 'note' ? ['co-owners noted'] : []),
        ...(tap.writtenRowIds.some((rowId) => {
          const before = tap.previous[rowId];
          return before?.origin != null && before.statusId === tap.statusId;
        })
          ? ['lot status made direct']
          : []),
        ...(tap.stampsVisitDate ? [] : ['reopened']),
      ];
    }
    case 'fields_edited':
      return [event.payload.location ? 'move' : 'correction'];
    case 'import':
      return [
        event.seq > 1 ? 're-import' : 'import',
        ...(event.payload.absorbed.length > 0 ? ['correction absorbed'] : []),
      ];
    case 'call_logged':
      return [`call (${event.payload.scope})`];
    default:
      return [event.type];
  }
}

async function storedRowsOf(store: TerrainDb, campaignId: string): Promise<Row[]> {
  return (await loadCampaign(store, campaignId))?.rows ?? [];
}

describe('stored rows always equal the replay of the event log (§6.3)', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))(
    'random sequence %i, lots by parcel ID',
    async (seed) => {
      const done = await runSequence(seed, null, 30);
      expect(done).toHaveLength(30);
    },
    60_000,
  );

  it.each(Array.from({ length: 12 }, (_, i) => i + 101))(
    'random sequence %i, lots by NUM_LOT',
    async (seed) => {
      const done = await runSequence(seed, 'NUM_LOT', 30);
      expect(done).toHaveLength(30);
    },
    60_000,
  );

  it('went through every kind of action on the way', () => {
    expect([...seen].sort()).toEqual(
      [
        'call (house)',
        'call (number)',
        'co-owners noted',
        'correction',
        'correction absorbed',
        'house tap',
        'houses regrouped',
        'import',
        'lot closed',
        'lot status made direct',
        'lots regrouped',
        'move',
        'note_added',
        'note_deleted',
        're-import',
        'reopened',
        'row tap',
        'undo',
      ].sort(),
    );
  });
});

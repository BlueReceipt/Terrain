import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerrainDb } from '../../src/data/db.ts';
import { campaignEvents, commitImport, editFields, loadCampaign } from '../../src/data/repo.ts';
import { detectRoles } from '../../src/domain/columns.ts';
import { foldStates, stateOf } from '../../src/domain/events.ts';
import { currentValue } from '../../src/domain/identity.ts';
import type { ParsedFile } from '../../src/domain/types.ts';
import { casesCampaign, freshDb, rowOf } from '../support/campaign.ts';
import { importInto, NOW, parseFixture } from '../support/import.ts';

// Alex, 2026-10-06: a client's file with fewer columns updates the campaign without emptying the
// columns it left out, and without doubling entries it can no longer tell apart by name or address.

/** The cases fixture without some of its columns, as a client might send it. */
function without(...dropped: string[]): ParsedFile {
  const file = parseFixture('public/cases.kmz');
  const columns = file.columns.filter((column) => !dropped.includes(column));
  return {
    ...file,
    columns,
    roles: detectRoles(columns),
    rows: file.rows.map((row) => ({
      ...row,
      fields: Object.fromEntries(
        Object.entries(row.fields).filter(([column]) => !dropped.includes(column)),
      ),
    })),
  };
}

describe('a file with fewer columns', () => {
  const first = importInto(parseFixture('public/cases.kmz'));

  it('keeps the values of the columns it left out, and calls nothing changed', () => {
    const again = importInto(without('CELLULAIRE', 'Language'), first);
    expect(again.report.unchanged).toBe(28);
    expect(again.merge.changes).toEqual([]);
    const marie = rowOf(again.merge.rows, 'P1-216B', 'Marie');
    expect(marie.sourceFields.CELLULAIRE).toBe('514 555-0199');
    // The column stays in the campaign, and in its exports.
    expect(again.campaign.columnOrder).toContain('CELLULAIRE');
    expect(again.campaign.roles.cellPhone).toBe('CELLULAIRE');
  });

  it('matches every entry without the names, or without the address: none comes in twice', () => {
    for (const dropped of [['PRENOM', 'NOM', 'Propriétaire', 'APPEL'], ['ADRESSE']]) {
      const again = importInto(without(...dropped), first);
      expect([again.merge.added.length, again.merge.missing.length], dropped.join()).toEqual([
        0, 0,
      ]);
      expect(again.merge.rows).toHaveLength(28);
      // Each entry keeps its owner: Marie is still Marie, Luc still Luc.
      for (const [parcel, name] of [
        ['P1-216B', 'Marie'],
        ['P1-216B', 'Luc'],
        ['P1-217A', 'Alain'],
      ] as const) {
        const before = rowOf(first.merge.rows, parcel, name);
        const after = again.merge.rows.find((row) => row.rowId === before.rowId);
        expect(after?.sourceFields.PRENOM, `${parcel} ${name}`).toBe(name);
        expect(after?.sourceFields.ADRESSE).toBe(before.sourceFields.ADRESSE);
      }
    }
  });
});

describe('a file with fewer columns, saved', () => {
  let db: TerrainDb | null = null;
  afterEach(async () => {
    db?.close();
    await db?.delete();
    db = null;
  });

  it('keeps a correction in a column it left out, with no disagreement, and replays the same', async () => {
    db = freshDb();
    const store = db;
    const plan = await casesCampaign(store);
    const campaignId = plan.campaign.id;
    const start = await loadCampaign(store, campaignId);
    if (!start) throw new Error('No campaign');
    const marie = rowOf(start.rows, 'P1-216B', 'Marie');
    await editFields(store, {
      campaignId,
      houseKey: marie.houseKey,
      eventId: 'e1-edit',
      now: NOW,
      target: 'house',
      writes: [{ rowIds: [marie.rowId], column: 'CELLULAIRE', value: '514 555-0100' }],
    });
    const before = await loadCampaign(store, campaignId);
    if (!before) throw new Error('No campaign');

    const again = importInto(
      without('CELLULAIRE'),
      { ...plan, campaign: before.campaign },
      before.rows,
    );
    expect(again.merge.conflicts).toEqual([]);
    await commitImport(store, again, 'import-2', NOW);
    const saved = await loadCampaign(store, campaignId);
    if (!saved) throw new Error('No campaign');
    const row = rowOf(saved.rows, 'P1-216B', 'Marie');
    expect(currentValue(row, 'CELLULAIRE')).toBe('514 555-0100');
    expect(row.sourceFields.CELLULAIRE).toBe('514 555-0199');

    const events = await campaignEvents(store, campaignId);
    const folded = foldStates(saved.rows, events, saved.campaign.roles);
    for (const stored of saved.rows) expect(stateOf(stored)).toEqual(folded.get(stored.rowId));
  });
});

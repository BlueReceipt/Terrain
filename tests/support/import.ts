import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialColorMap, planImport, type ImportPlan } from '../../src/domain/importPlan.ts';
import { parseKml, parseKmz } from '../../src/domain/kml.ts';
import { DEFAULT_STATUSES } from '../../src/domain/statuses.ts';
import { parseTabular } from '../../src/domain/tabular.ts';
import type { ParsedFile, Row } from '../../src/domain/types.ts';
import { parseXml } from './xml.ts';

export const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
export const NOW = '2026-09-26T14:32:00-04:00';

export function readFixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, path)));
}

const parsedFixtures = new Map<string, ParsedFile>();

/** Parsed once per test file: the real export takes seconds to parse. Treat the result as read-only. */
export function parseFixture(path: string): ParsedFile {
  const cached = parsedFixtures.get(path);
  if (cached) return cached;
  const bytes = readFixture(path);
  // As src/data/files.ts does for a file the user picks.
  const parsed = /\.kmz$/i.test(path)
    ? parseKmz(bytes, parseXml, path)
    : /\.kml$/i.test(path)
      ? parseKml(new TextDecoder().decode(bytes), parseXml, path)
      : parseTabular(bytes, path);
  parsedFixtures.set(path, parsed);
  return parsed;
}

export function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${String(++n).padStart(4, '0')}`;
}

/** Imports a parsed file into a new campaign, or into the committed state of an earlier plan. */
export function importInto(
  parsed: ParsedFile,
  earlier: ImportPlan | null = null,
  existingRows?: Row[],
  ownNotes?: ReadonlyMap<string, readonly string[]>,
): ImportPlan {
  const colorMap = initialColorMap(parsed, DEFAULT_STATUSES, earlier?.campaign.colorMap).colorMap;
  return planImport({
    parsed,
    campaign: earlier?.campaign ?? null,
    existingRows: existingRows ?? earlier?.merge.rows ?? [],
    statuses: DEFAULT_STATUSES,
    roles: { ...parsed.roles, ...earlier?.campaign.roles },
    colorMap,
    lotColumn: earlier?.campaign.lotColumn ?? null,
    now: NOW,
    newId: counter(earlier ? 'n' : 'r'),
    ownNotes,
  });
}

export function rowByParcel(plan: ImportPlan, parcelIdRaw: string, lastName?: string): Row {
  const row = plan.merge.rows.find(
    (r) =>
      r.parcelIdRaw === parcelIdRaw && (lastName === undefined || r.sourceFields.NOM === lastName),
  );
  if (!row) throw new Error(`No row ${parcelIdRaw} ${lastName ?? ''}`);
  return row;
}

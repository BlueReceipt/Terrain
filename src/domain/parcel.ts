import { compactKey } from './text.ts';

const LOOKS_LIKE_AN_ID = /^(?=.*\d)(?=.*[-A-Za-z]).+$/;
const WRAPPING = /^[([{"']+|[)\]}"']+$/g;

/**
 * The IDs a parcel ID cell lists. New lines, commas, semicolons and slashes separate them, and so
 * do spaces between two ID-like pieces ("P1-160 P1-160A"). A number with spaces ("1 234 701") is one ID.
 */
export function splitParcelIds(cell: string): string[] {
  const ids: string[] = [];
  for (const chunk of cell.split(/[\n\r,;/]+/)) {
    // "P10-7 (petite terrasse ajoutée en 2024)": words in parentheses are a note, not an ID.
    const trimmed = chunk.replace(/\s*\([^()]*\s[^()]*\)\s*$/, '').trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/);
    if (words.length > 1 && words.every((word) => LOOKS_LIKE_AN_ID.test(word))) {
      ids.push(...words);
    } else {
      ids.push(trimmed);
    }
  }
  // "P10-005-ADJ-1 (P10-5AP)": the second ID comes in parentheses.
  // "PT7-012/011/010" is shorthand for PT7-012, PT7-011 and PT7-010.
  const expanded: string[] = [];
  for (const id of ids.map((raw) => raw.replace(WRAPPING, '')).filter(Boolean)) {
    const previous = expanded.at(-1);
    const prefixEnd = previous?.lastIndexOf('-') ?? -1;
    expanded.push(
      previous && prefixEnd > 0 && /^\d+[A-Za-z]?$/.test(id)
        ? previous.slice(0, prefixEnd + 1) + id
        : id,
    );
  }
  return expanded;
}

/** The lot keys of a cell: each ID it lists, normalized, minus the ones marked old. Blank cells have none. */
export function lotKeysOf(cell: string, oldIds: readonly string[] = []): string[] {
  const old = new Set(oldIds.map(compactKey));
  const keys = splitParcelIds(cell)
    .map(compactKey)
    .filter((key) => key !== '' && !old.has(key));
  return [...new Set(keys)];
}

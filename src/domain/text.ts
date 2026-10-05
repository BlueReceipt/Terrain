const ACCENTS = /[̀-ͯ]/g;

/** Lowercase, accents stripped, every run of punctuation or whitespace (non-breaking included) as one space. */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Accents stripped, all whitespace removed, uppercased: "1 234 567" and "1234567" become one key. */
export function compactKey(text: string): string {
  return text.normalize('NFKD').replace(ACCENTS, '').replace(/\s+/gu, '').toUpperCase();
}

/** Levenshtein distance, giving up early: returns max + 1 as soon as the distance exceeds max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? Infinity) + 1,
        (current[j - 1] ?? Infinity) + 1,
        (previous[j - 1] ?? Infinity) + cost,
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return Math.min(previous[b.length] ?? max + 1, max + 1);
}

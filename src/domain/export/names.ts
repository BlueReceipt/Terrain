/** A name part safe in a file name on Windows and Android: no path or reserved characters. */
function safe(part: string): string {
  return part
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Export file names (§5.8): `Terrain_<campaign>_<YYYY-MM-DD>.xlsx`, and for My Maps
 * `Terrain_<campaign>_<layer>_<YYYY-MM-DD>.csv`.
 */
export function exportFileName(parts: readonly string[], date: string, extension: string): string {
  const named = parts.map(safe).filter(Boolean);
  return `${['Terrain', ...named, date].join('_')}.${extension}`;
}

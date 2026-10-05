import { ImportError } from '../domain/errors.ts';
import { parseKml, parseKmz, type ParseXml } from '../domain/kml.ts';
import type { ParsedFile } from '../domain/types.ts';

const parseXml: ParseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');

/** Reads a file Alex picked: KMZ or KML from My Maps, or a spreadsheet with coordinates (§5.1). */
export async function readImportFile(file: File): Promise<ParsedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name;
  if (/\.kmz$/i.test(name)) return parseKmz(bytes, parseXml, name);
  if (/\.kml$/i.test(name)) return parseKml(new TextDecoder().decode(bytes), parseXml, name);
  if (/\.(xlsx|xls|csv)$/i.test(name)) {
    // SheetJS is most of the bundle; it loads only when a spreadsheet is imported (still precached for offline).
    const { parseTabular } = await import('../domain/tabular.ts');
    return parseTabular(bytes, name);
  }
  throw new ImportError('unsupported-file');
}

/** Hands a file Terrain made to the browser's downloads (on Android, the Downloads folder). */
export function saveFile(name: string, contents: string | Blob, type: string): void {
  const url = URL.createObjectURL(
    typeof contents === 'string' ? new Blob([contents], { type }) : contents,
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

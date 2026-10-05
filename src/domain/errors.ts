/** Why a file can't be imported. The UI turns each code into a sentence (src/ui/strings.ts). */
export type ImportErrorCode =
  | 'unsupported-file'
  | 'damaged-kmz'
  | 'no-kml-in-kmz'
  | 'network-link-only'
  | 'not-kml'
  | 'no-rows'
  | 'no-coordinates'
  | 'unreadable-spreadsheet';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  /** For network-link-only: where the file's link points (a My Maps export, to its map online). */
  readonly link: string | undefined;

  constructor(code: ImportErrorCode, link?: string) {
    super(code);
    this.name = 'ImportError';
    this.code = code;
    this.link = link;
  }
}

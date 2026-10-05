import * as XLSX from 'xlsx';

export interface Sheet {
  name: string;
  /** The header, then the lines. Every cell is text, so Excel shows it exactly as written. */
  lines: readonly (readonly string[])[];
}

/** Column widths that fit the longest value, within reason (Excel's unit is about one character). */
function widths(lines: Sheet['lines']): { wch: number }[] {
  const longest: number[] = [];
  for (const line of lines) {
    line.forEach((cell, i) => {
      const width = Math.max(...cell.split(/\r?\n/).map((part) => part.length));
      longest[i] = Math.max(longest[i] ?? 0, width);
    });
  }
  return longest.map((width) => ({ wch: Math.min(Math.max(width + 2, 8), 60) }));
}

/** An .xlsx workbook of text cells. SheetJS loads with this module, only when exporting. */
export function workbookBytes(sheets: readonly Sheet[]): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const lines = sheet.lines.map((line) => [...line]);
    const page = XLSX.utils.aoa_to_sheet(lines);
    page['!cols'] = widths(sheet.lines);
    XLSX.utils.book_append_sheet(book, page, sheet.name);
  }
  const bytes = XLSX.write(book, {
    type: 'array',
    bookType: 'xlsx',
    compression: true,
  }) as ArrayBuffer;
  return new Uint8Array(bytes);
}

import { signal } from '@preact/signals';
import { backupFileName, makeBackup } from '../data/backup.ts';
import { nowWithOffset } from '../data/clock.ts';
import { markExported, notExportedCount } from '../data/repo.ts';
import { journalSheet } from '../domain/export/journal.ts';
import { myMapsCsv } from '../domain/export/mymaps.ts';
import { exportFileName } from '../domain/export/names.ts';
import { parcelsSheet, type ExportInput } from '../domain/export/sheet.ts';
import { DEFAULT_DATE_FORMAT, fileDate } from '../domain/format.ts';
import { notify } from './actions.ts';
import { current, database, events, settings, statuses } from './flow.ts';
import { deliver } from './share.ts';
import { clientWords, strings } from './strings.ts';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Changes made since the last export. */
export const notExported = signal(0);
/** An export is being made: its buttons wait for it. */
export const exporting = signal(false);

export async function refreshNotExported(): Promise<void> {
  const db = database();
  const loaded = current.value;
  notExported.value = db && loaded ? await notExportedCount(db, loaded.campaign.id) : 0;
}

function exportInput(): ExportInput | null {
  const loaded = current.value;
  if (!loaded) return null;
  return {
    campaign: loaded.campaign,
    rows: loaded.rows,
    events: events.value,
    words: clientWords.notes,
    appHeaders: clientWords.exports.appHeaders,
    format: settings.value?.dateFormat ?? DEFAULT_DATE_FORMAT,
    notesMode: settings.value?.notesExportMode ?? 'joined',
  };
}

/**
 * Makes the files, hands them over, and counts everything so far as exported. A share sheet
 * closed without sharing exports nothing.
 */
async function run(make: (input: ExportInput, now: string) => Promise<File[]>): Promise<void> {
  const db = database();
  const loaded = current.value;
  const input = exportInput();
  if (!db || !loaded || !input || exporting.value) return;
  exporting.value = true;
  try {
    const now = nowWithOffset();
    const files = await make(input, now);
    const delivery = await deliver(files);
    if (delivery === 'cancelled') return;
    await markExported(db, loaded.campaign.id, now);
    await refreshNotExported();
    const names = files.map((file) => file.name).join(', ');
    notify(delivery === 'shared' ? strings.exports.shared(names) : strings.exports.saved(names));
  } catch {
    notify(strings.exports.failed);
  } finally {
    exporting.value = false;
  }
}

/** Excel for the client: Parcels and Journal. */
export function exportExcel(): Promise<void> {
  return run(async (input, now) => {
    // SheetJS is most of the bundle: it loads only when a spreadsheet is made or read.
    const { workbookBytes } = await import('../domain/export/xlsx.ts');
    const bytes = workbookBytes([
      { name: clientWords.exports.parcelsSheet, lines: parcelsSheet(input) },
      {
        name: clientWords.exports.journalSheet,
        lines: journalSheet({
          campaign: input.campaign,
          rows: input.rows,
          events: input.events,
          statuses: statuses.value,
          noteWords: clientWords.notes,
          words: clientWords.journal,
          format: input.format,
        }),
      },
    ]);
    const name = exportFileName([input.campaign.name], fileDate(now), 'xlsx');
    return [new File([bytes], name, { type: XLSX_TYPE })];
  });
}

/** The My Maps update of one layer. */
export function exportLayer(layer: string): Promise<void> {
  return run((input, now) => {
    const name = exportFileName([input.campaign.name, layer], fileDate(now), 'csv');
    return Promise.resolve([
      new File([myMapsCsv(input, layer)], name, { type: 'text/csv;charset=utf-8' }),
    ]);
  });
}

/** Backup: every campaign on the phone, to restore here or on a new phone. */
export function exportBackup(): Promise<void> {
  return run(async (_input, now) => {
    const db = database();
    if (!db) return [];
    const name = backupFileName(now);
    const backup = JSON.stringify(await makeBackup(db, now));
    return [new File([backup], name, { type: 'application/json' })];
  });
}

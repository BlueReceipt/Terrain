import { FilePicker } from './FilePicker.tsx';
import { pickBackup, pickFile } from './flow.ts';
import { strings } from './strings.ts';

const ACCEPTED_FILES = '.kmz,.kml,.xlsx,.csv';

export function ImportButton({ label, primary = true }: { label: string; primary?: boolean }) {
  return (
    <FilePicker
      label={label}
      accept={ACCEPTED_FILES}
      primary={primary}
      onFile={(file) => void pickFile(file)}
    />
  );
}

/** Restore lives in Settings; until Settings exists, it sits next to Import file. */
export function RestoreButton() {
  return (
    <FilePicker
      label={strings.backup.restore}
      accept=".json,application/json"
      primary={false}
      onFile={(file) => void pickBackup(file)}
    />
  );
}

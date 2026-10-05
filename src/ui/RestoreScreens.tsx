import type { Backup, RestoreErrorCode } from '../data/backup.ts';
import { DEFAULT_DATE_FORMAT, formatTime } from '../domain/format.ts';
import { confirmRestore, leaveImport, settings } from './flow.ts';
import { RestoreButton } from './ImportButton.tsx';
import { strings } from './strings.ts';

/** Restore replaces everything, so it asks first (§5.8). */
export function Restore({ backup, restoring }: { backup: Backup; restoring: boolean }) {
  const format = settings.value?.dateFormat ?? DEFAULT_DATE_FORMAT;
  return (
    <main class="screen">
      <header>
        <h1>{strings.backup.title}</h1>
        <p class="lead">{strings.backup.madeOn(formatTime(backup.createdAt, format))}</p>
      </header>
      <p>
        {strings.backup.holds(
          backup.campaigns.map((campaign) => campaign.name),
          backup.rows.length,
        )}
      </p>
      <p class="notice">{strings.backup.replaces}</p>
      <div class="actions">
        <button
          type="button"
          class="button primary"
          disabled={restoring}
          onClick={() => void confirmRestore()}
        >
          {strings.backup.replace}
        </button>
        <button type="button" class="button" disabled={restoring} onClick={leaveImport}>
          {strings.cancel}
        </button>
      </div>
    </main>
  );
}

export function RestoreFailed({ reason }: { reason: RestoreErrorCode | 'storage' }) {
  return (
    <main class="screen">
      <header>
        <h1>{strings.backup.failedTitle}</h1>
        <p class="lead">{strings.backup.failed[reason]}</p>
      </header>
      <div class="actions">
        <RestoreButton />
        <button type="button" class="button" onClick={leaveImport}>
          {strings.cancel}
        </button>
      </div>
    </main>
  );
}

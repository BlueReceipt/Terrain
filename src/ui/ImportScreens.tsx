import { useState } from 'preact/hooks';
import type { ImportErrorCode } from '../domain/errors.ts';
import type { ColumnRoles, FieldRole, ParsedFile } from '../domain/types.ts';
import type { MyMapsProblem } from './demo.ts';
import {
  backToLinks,
  confirmMapping,
  current,
  leaveImport,
  showReport,
  statuses,
  stopLookingUp,
  type FailedReason,
} from './flow.ts';
import { ImportButton } from './ImportButton.tsx';
import { strings } from './strings.ts';
import { Swatch } from './Swatch.tsx';

export function Reading({ fileName }: { fileName: string }) {
  return (
    <main class="screen centered" aria-busy="true">
      <p class="lead">{strings.reading(fileName)}</p>
    </main>
  );
}

/** Houses without coordinates, found from their address through Terrain's relay. */
export function Placing({ total, done }: { total: number; done: number }) {
  return (
    <main class="screen centered" aria-busy="true">
      <p class="lead">{strings.placing.finding(total)}</p>
      <p class="strong" role="status">
        {strings.placing.progress(done, total)}
      </p>
      <p class="muted">{strings.placing.what}</p>
      <div class="actions">
        <button type="button" class="button" onClick={stopLookingUp}>
          {strings.placing.stop}
        </button>
      </div>
    </main>
  );
}

export function Failed({ reason }: { reason: FailedReason }) {
  const link = reason.startsWith('mymaps-')
    ? (reason.slice('mymaps-'.length) as MyMapsProblem)
    : null;
  const message = link
    ? strings.failed.myMaps[link]
    : reason === 'unexpected'
      ? strings.failed.unexpected
      : reason === 'storage'
        ? strings.failed.storage
        : strings.failed.reasons[reason as ImportErrorCode];
  return (
    <main class="screen">
      <h1>{link ? strings.failed.myMapsTitle : strings.failed.title}</h1>
      <p class="lead" role="alert">
        {message}
      </p>
      <div class="actions">
        {link && (
          <button type="button" class="button primary" onClick={backToLinks}>
            {strings.failed.anotherLink}
          </button>
        )}
        {reason !== 'storage' && (
          <ImportButton label={strings.failed.chooseAnother} primary={!link} />
        )}
        {current.value && (
          <button type="button" class="button" onClick={leaveImport}>
            {strings.cancel}
          </button>
        )}
      </div>
    </main>
  );
}

/** One screen, shown only when an app-owned column or a spreadsheet's parcel ID can't be matched. */
export function ColumnMapping({
  parsed,
  roles,
  missing,
}: {
  parsed: ParsedFile;
  roles: ColumnRoles;
  missing: FieldRole[];
}) {
  const [chosen, setChosen] = useState<Partial<Record<FieldRole, string>>>({});
  const needsParcelId = missing.includes('parcelId');
  return (
    <main class="screen">
      <h1>{strings.mapping.title}</h1>
      <p class="lead">{strings.mapping.intro(parsed.fileName)}</p>
      {missing.map((role) => (
        <label class="field" key={role}>
          {strings.mapping.roles[role] ?? role}
          <select
            value={chosen[role] ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setChosen((previous) => {
                const next = { ...previous };
                if (value) next[role] = value;
                else next[role] = undefined;
                return next;
              });
            }}
          >
            <option value="">{role === 'parcelId' ? '' : strings.mapping.notInFile}</option>
            {parsed.columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div class="actions">
        <button
          type="button"
          class="button primary"
          disabled={needsParcelId && !chosen.parcelId}
          onClick={() => {
            const picked = Object.fromEntries(
              Object.entries(chosen).filter(([, column]) => column),
            ) as Partial<Record<FieldRole, string>>;
            confirmMapping(parsed, roles, picked);
          }}
        >
          {strings.continue}
        </button>
        <button type="button" class="button" onClick={leaveImport}>
          {strings.cancel}
        </button>
      </div>
    </main>
  );
}

/** Each My Maps pin color becomes a status; Alex checks Terrain's guesses once per campaign. */
export function PinColors({
  parsed,
  roles,
  colorMap,
  unmatched,
}: {
  parsed: ParsedFile;
  roles: ColumnRoles;
  colorMap: Record<string, string>;
  unmatched: string[];
}) {
  const [map, setMap] = useState(colorMap);
  const counts = new Map<string, { pins: number; texts: Map<string, number> }>();
  for (const row of parsed.rows) {
    if (row.pinColor === null) continue;
    const entry = counts.get(row.pinColor) ?? { pins: 0, texts: new Map<string, number>() };
    entry.pins += 1;
    const text = roles.packageStatus ? (row.fields[roles.packageStatus] ?? '').trim() : '';
    if (text) entry.texts.set(text, (entry.texts.get(text) ?? 0) + 1);
    counts.set(row.pinColor, entry);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1].pins - a[1].pins);
  return (
    <main class="screen">
      <h1>{strings.colors.title}</h1>
      <p class="lead">{strings.colors.intro}</p>
      <ul class="list">
        {colors.map(([color, entry]) => {
          const texts = [...entry.texts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([text]) => text);
          return (
            <li key={color} class="color-row">
              <Swatch color={color} />
              <div class="grow">
                <p class="strong">{strings.pins(entry.pins)}</p>
                {texts.length > 0 && <p class="muted">{strings.colors.seenAs(texts)}</p>}
                {unmatched.includes(color) && <p class="muted strong">{strings.colors.noGuess}</p>}
                <select
                  aria-label={strings.colors.statusFor(color)}
                  value={map[color] ?? ''}
                  onChange={(event) => {
                    const statusId = event.currentTarget.value;
                    setMap((previous) => ({ ...previous, [color]: statusId }));
                  }}
                >
                  {statuses.value
                    .filter((status) => !status.archived)
                    .map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.label}
                      </option>
                    ))}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
      <div class="actions">
        <button
          type="button"
          class="button primary"
          onClick={() => {
            void showReport(parsed, roles, map, false);
          }}
        >
          {strings.continue}
        </button>
        <button type="button" class="button" onClick={leaveImport}>
          {strings.cancel}
        </button>
      </div>
    </main>
  );
}

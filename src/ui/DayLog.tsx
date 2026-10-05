import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { nowWithOffset } from '../data/clock.ts';
import { activeDays, dayLog, dayLogText } from '../domain/daylog.ts';
import { DEFAULT_DATE_FORMAT, fileDate, formatTime } from '../domain/format.ts';
import { notify } from './actions.ts';
import { useDialog } from './dialog.ts';
import { notExported, refreshNotExported } from './exports.ts';
import { current, events, settings, statuses } from './flow.ts';
import { panel, selectHouse } from './mapState.ts';
import { strings } from './strings.ts';
import { Swatch } from './Swatch.tsx';

/**
 * The day log (§5.7): the day's counts, then one line per action, named by house; a line shows its
 * house on the map. Copy as text, Share, and what is still to export.
 */
export function DayLogPanel() {
  const today = fileDate(nowWithOffset());
  const day = useSignal(today);
  useEffect(() => {
    void refreshNotExported();
  }, []);
  const ref = useDialog<HTMLElement>(() => {
    panel.value = null;
  });
  const loaded = current.value;
  if (!loaded) return null;
  const format = settings.value?.dateFormat ?? DEFAULT_DATE_FORMAT;
  const words = strings.dayLog.words;
  const log = dayLog({
    day: day.value,
    campaign: loaded.campaign,
    rows: loaded.rows,
    events: events.value,
    statuses: statuses.value,
    words,
  });
  const days = activeDays(events.value);
  const earlier = days.filter((candidate) => candidate < day.value).at(-1);
  const later = days.find((candidate) => candidate > day.value);
  const text = () => dayLogText(log, loaded.campaign.name, format, words);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      notify(strings.dayLog.copied);
    } catch {
      notify(strings.dayLog.copyFailed);
    }
  };
  const share = async () => {
    if (!('share' in navigator)) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: strings.dayLog.title, text: text() });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) await copy();
    }
  };

  return (
    <section
      ref={ref}
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-label={strings.dayLog.title}
    >
      <header class="panel-head">
        <button
          type="button"
          class="button"
          onClick={() => {
            panel.value = null;
          }}
        >
          ‹ {strings.dayLog.back}
        </button>
        <h2 class="panel-title" tabIndex={-1}>
          {strings.dayLog.title}
        </h2>
      </header>
      <div class="day-picker">
        <button
          type="button"
          class="icon-button"
          aria-label={strings.dayLog.previousDay}
          disabled={earlier === undefined}
          onClick={() => {
            if (earlier) day.value = earlier;
          }}
        >
          ‹
        </button>
        <input
          type="date"
          class="text-input"
          aria-label={strings.dayLog.day}
          value={day.value}
          onInput={(event) => {
            const chosen = event.currentTarget.value;
            if (chosen) day.value = chosen;
          }}
        />
        <button
          type="button"
          class="icon-button"
          aria-label={strings.dayLog.nextDay}
          disabled={later === undefined}
          onClick={() => {
            if (later) day.value = later;
          }}
        >
          ›
        </button>
      </div>
      <div class="panel-scroll">
        <ul class="day-counts" aria-label={strings.dayLog.summary}>
          {log.counts.map((count) => (
            <li key={count.statusId}>
              <Swatch color={count.color} />
              <span>{words.statusCount(count.label, count.direct, 0)}</span>
              {count.viaLot > 0 && <span class="muted">{strings.dayLog.viaLot(count.viaLot)}</span>}
            </li>
          ))}
          {log.corrections > 0 && <li>{words.corrections(log.corrections)}</li>}
          {log.calls > 0 && <li>{words.calls(log.calls)}</li>}
          {log.notes > 0 && <li>{words.notes(log.notes)}</li>}
        </ul>
        {log.lines.length === 0 ? (
          <p class="muted">{words.nothing}</p>
        ) : (
          <ol class="log-lines">
            {log.lines.map((line) => (
              <li key={line.eventId}>
                <button
                  type="button"
                  class="log-line"
                  disabled={line.houseKey === null}
                  onClick={() => {
                    if (line.houseKey === null) return;
                    panel.value = null;
                    selectHouse(line.houseKey);
                  }}
                >
                  <span class="log-time">{formatTime(line.at, 'HH:mm')}</span>
                  <span class="log-body">
                    <span class="strong">{line.address}</span> {line.text}
                    {line.details.map((detail) => (
                      <span key={detail} class="log-detail">
                        {detail}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <footer class="panel-footer">
        <p class={notExported.value > 0 ? 'strong' : 'muted'}>
          {strings.dayLog.notExported(notExported.value)}
        </p>
        <div class="row-actions">
          <button type="button" class="button" onClick={() => void copy()}>
            {strings.dayLog.copy}
          </button>
          <button type="button" class="button" onClick={() => void share()}>
            {strings.dayLog.share}
          </button>
          <button
            type="button"
            class="button primary"
            onClick={() => {
              panel.value = 'export';
            }}
          >
            {strings.dayLog.export}
          </button>
        </div>
      </footer>
    </section>
  );
}

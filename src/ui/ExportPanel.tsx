import { useEffect } from 'preact/hooks';
import {
  layerRows,
  MY_MAPS_ROW_LIMIT,
  positionedBy,
  unplaceable,
} from '../domain/export/mymaps.ts';
import {
  exportBackup,
  exportExcel,
  exporting,
  exportLayer,
  notExported,
  refreshNotExported,
} from './exports.ts';
import { useDialog } from './dialog.ts';
import { current } from './flow.ts';
import { panel } from './mapState.ts';
import { strings } from './strings.ts';

/** Export: Excel for the client, the My Maps update of each layer, and the backup. */
export function ExportPanel() {
  useEffect(() => {
    void refreshNotExported();
  }, []);
  const ref = useDialog<HTMLElement>(() => {
    panel.value = 'dayLog';
  });
  const loaded = current.value;
  if (!loaded) return null;
  const busy = exporting.value;
  const layers = loaded.campaign.layers.filter((layer) =>
    loaded.rows.some((row) => row.layer === layer),
  );

  return (
    <section
      ref={ref}
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-label={strings.exports.title}
    >
      <header class="panel-head">
        <button
          type="button"
          class="button"
          onClick={() => {
            panel.value = 'dayLog';
          }}
        >
          ‹ {strings.exports.back}
        </button>
        <h2 class="panel-title" tabIndex={-1}>
          {strings.exports.title}
        </h2>
      </header>
      <div class="panel-scroll">
        <p class={notExported.value > 0 ? 'strong' : 'muted'}>
          {strings.dayLog.notExported(notExported.value)}
        </p>
        {busy && (
          <p class="muted" role="status">
            {strings.exports.making}
          </p>
        )}
        <section class="card-section" aria-label={strings.exports.excel}>
          <h3>{strings.exports.excel}</h3>
          <p class="muted">{strings.exports.excelHelp}</p>
          <button
            type="button"
            class="button primary"
            disabled={busy}
            onClick={() => void exportExcel()}
          >
            {strings.exports.excelButton}
          </button>
        </section>
        <section class="card-section" aria-label={strings.exports.myMaps}>
          <h3>{strings.exports.myMaps}</h3>
          <p class="muted">{strings.exports.myMapsHelp}</p>
          <ul class="export-layers">
            {layers.map((layer) => {
              const count = layerRows(loaded.rows, layer).length;
              const lost = unplaceable(loaded.rows, layer, loaded.campaign.roles).length;
              return (
                <li key={layer}>
                  <button
                    type="button"
                    class="button"
                    disabled={busy}
                    onClick={() => void exportLayer(layer)}
                  >
                    {strings.exports.layer(layer, count)}
                  </button>
                  <p class="muted">
                    {positionedBy(loaded.rows, layer) === 'coordinates'
                      ? strings.exports.byCoordinates
                      : strings.exports.byLocation}
                  </p>
                  {lost > 0 && <p class="strong">{strings.exports.cantPlace(lost)}</p>}
                  {count > MY_MAPS_ROW_LIMIT && (
                    <p class="strong">{strings.exports.tooBig(MY_MAPS_ROW_LIMIT)}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <section class="card-section" aria-label={strings.exports.backup}>
          <h3>{strings.exports.backup}</h3>
          <p class="muted">{strings.exports.backupHelp}</p>
          <button type="button" class="button" disabled={busy} onClick={() => void exportBackup()}>
            {strings.exports.backupButton}
          </button>
        </section>
      </div>
    </section>
  );
}

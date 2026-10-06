import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { lotLabel, lotNumberColumns } from '../domain/identity.ts';
import type { ImportPlan } from '../domain/importPlan.ts';
import type { HouseSummary, RowSummary } from '../domain/report.ts';
import {
  leaveImport,
  openCampaign,
  setLotColumn,
  startNewCampaign,
  statuses,
  toggleOldParcelId,
  type LookUp,
} from './flow.ts';
import { strings } from './strings.ts';
import { Swatch } from './Swatch.tsx';

/** A report list that renders its items only once opened: some hold hundreds of houses. */
function Section({
  title,
  count,
  help,
  children,
}: {
  title: string;
  count: number;
  help?: string;
  children: () => ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      class="section"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span>{title}</span>
        <span class="section-count">{count.toLocaleString('en-CA')}</span>
      </summary>
      {help && <p class="muted">{help}</p>}
      {open && children()}
    </details>
  );
}

function RowLine({ row }: { row: RowSummary }) {
  return (
    <li class="row-line">
      <span class="parcel">{row.parcelId}</span> <span>{row.owner || strings.noName}</span>
    </li>
  );
}

function House({ house }: { house: HouseSummary }) {
  return (
    <li>
      <p class="strong">{house.address || strings.noAddress}</p>
      {house.town && <p class="muted">{house.town}</p>}
      <ul class="rows">
        {house.rows.map((row) => (
          <RowLine key={row.rowId} row={row} />
        ))}
      </ul>
    </li>
  );
}

export function ImportReport({
  plan,
  saving,
  saveFailed,
  lookUp,
}: {
  plan: ImportPlan;
  saving: boolean;
  saveFailed: boolean;
  lookUp: LookUp;
}) {
  const report = plan.report;
  const text = strings.report;
  const found = report.placedAtAddress + report.placedOnStreet.length;
  const statusLabel = (id: string | null) =>
    statuses.value.find((status) => status.id === id)?.label ?? '';
  return (
    <main class="screen report">
      <header>
        <h1>{text.title}</h1>
        <p class="muted">{text.inFile(report.rowsInFile, report.fileName)}</p>
      </header>

      <dl class="counts">
        <div>
          <dt>{text.added}</dt>
          <dd>{report.added.toLocaleString('en-CA')}</dd>
        </div>
        <div>
          <dt>{text.updated}</dt>
          <dd>{report.updated.toLocaleString('en-CA')}</dd>
        </div>
        <div>
          <dt>{text.unchanged}</dt>
          <dd>{report.unchanged.toLocaleString('en-CA')}</dd>
        </div>
        <div>
          <dt>{text.houses}</dt>
          <dd>{report.houseCount.toLocaleString('en-CA')}</dd>
        </div>
      </dl>

      {report.mostlyNewParcelIds && !plan.isNewCampaign && <p class="notice">{text.mostlyNew}</p>}
      {lookUp === 'failed' && <p class="notice">{text.lookUpFailed}</p>}
      {lookUp === 'stopped' && <p class="notice">{text.lookUpStopped}</p>}

      <label class="field">
        {text.groupBy}
        <select
          value={plan.campaign.lotColumn ?? ''}
          onChange={(event) => {
            setLotColumn(event.currentTarget.value || null);
          }}
        >
          {/* By default, co-owners of one plot: the same parcel ID and the same lot number. */}
          <option value="">
            {text.parcelIdOption(lotNumberColumns(plan.campaign.columnOrder)[0])}
          </option>
          {plan.campaign.columnOrder.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
      </label>

      <div class="sections">
        {report.ownerDetailsChanged.length > 0 && (
          <Section title={text.ownerDetailsChanged} count={report.ownerDetailsChanged.length}>
            {() => (
              <ul class="list">
                {report.ownerDetailsChanged.map((row) => (
                  <RowLine key={row.rowId} row={row} />
                ))}
              </ul>
            )}
          </Section>
        )}
        {report.conflicts.length > 0 && (
          <Section title={text.conflicts} count={report.conflicts.length}>
            {() => (
              <ul class="list">
                {report.conflicts.map((conflict) => (
                  <li key={`${conflict.rowId}:${conflict.column}`}>
                    <p>
                      <span class="parcel">{conflict.row.parcelId}</span>{' '}
                      {conflict.row.owner || strings.noName}
                    </p>
                    <p class="muted">
                      {text.conflict(conflict.column, conflict.local, conflict.incoming)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
        {report.missing.length > 0 && (
          <Section title={text.missing} count={report.missing.length} help={text.missingHelp}>
            {() => (
              <ul class="list">
                {report.missing.map((row) => (
                  <RowLine key={row.rowId} row={row} />
                ))}
              </ul>
            )}
          </Section>
        )}
        {report.duplicates.length > 0 && (
          <Section
            title={text.duplicates}
            count={report.duplicates.length}
            help={text.duplicatesHelp}
          >
            {() => (
              <ul class="list">
                {report.duplicates.map((group) => (
                  <li key={group.map((row) => row.rowId).join()}>
                    <p class="strong">{group[0]?.address || strings.noAddress}</p>
                    <ul class="rows">
                      {group.map((row) => (
                        <RowLine key={row.rowId} row={row} />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
        <Section
          title={text.noPosition}
          count={report.housesWithoutPosition.length}
          help={text.noPositionHelp}
        >
          {() => (
            <ul class="list">
              {report.housesWithoutPosition.map((house) => (
                <House key={house.houseKey} house={house} />
              ))}
            </ul>
          )}
        </Section>
        {found > 0 && (
          <>
            <div class="section-line">
              <span>{text.placedAtAddress}</span>
              <span class="section-count">{report.placedAtAddress.toLocaleString('en-CA')}</span>
            </div>
            <Section
              title={text.placedOnStreet}
              count={report.placedOnStreet.length}
              help={text.placedOnStreetHelp}
            >
              {() => (
                <ul class="list">
                  {report.placedOnStreet.map((house) => (
                    <House key={house.houseKey} house={house} />
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
        <Section title={text.severalRows} count={report.housesWithSeveralRows.length}>
          {() => (
            <ul class="list">
              {report.housesWithSeveralRows.map((house) => (
                <House key={house.houseKey} house={house} />
              ))}
            </ul>
          )}
        </Section>
        <Section title={text.lots} count={report.lotsAcrossHouses.length}>
          {() => (
            <ul class="list">
              {report.lotsAcrossHouses.map((lot) => (
                <li key={lot.lotKey}>
                  <p class="parcel">{lotLabel(lot.lotKey)}</p>
                  <ul class="rows">
                    {lot.houses.map((house) => (
                      <li key={house.houseKey}>
                        {house.address || strings.noAddress}
                        {house.town ? `, ${house.town}` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          title={text.severalIds}
          count={report.severalParcelIds.length}
          help={text.severalIdsHelp}
        >
          {() => (
            <ul class="list">
              {report.severalParcelIds.map(({ row, ids, oldIds }) => (
                <li key={row.rowId}>
                  <p class="strong">{row.owner || strings.noName}</p>
                  <p class="muted">{row.address || strings.noAddress}</p>
                  <div class="id-toggles">
                    {ids.map((id) => (
                      <button
                        key={id}
                        type="button"
                        class="button id-toggle"
                        aria-pressed={oldIds.includes(id)}
                        aria-label={text.markOld(id)}
                        onClick={() => {
                          toggleOldParcelId(row.rowId, id);
                        }}
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          title={text.sharedPoints}
          count={report.sharedPoints.length}
          help={text.sharedPointsHelp}
        >
          {() => (
            <ul class="list">
              {report.sharedPoints.map((group) => (
                <li key={group.map((house) => house.houseKey).join()}>
                  <ul class="rows">
                    {group.map((house) => (
                      <House key={house.houseKey} house={house} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={text.spread} count={report.spreadHouses.length} help={text.spreadHelp}>
          {() => (
            <ul class="list">
              {report.spreadHouses.map((house) => (
                <House key={house.houseKey} house={house} />
              ))}
            </ul>
          )}
        </Section>
        {report.colors.length > 0 && (
          <Section title={text.colors} count={report.colors.length}>
            {() => (
              <ul class="list">
                {report.colors.map((color) => (
                  <li key={color.color} class="color-row">
                    <Swatch color={color.color} />
                    <span class="grow">{strings.pins(color.count)}</span>
                    <span class="strong">{statusLabel(color.statusId)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>

      {report.referenceFeatures > 0 && (
        <p class="muted">{text.reference(report.referenceFeatures)}</p>
      )}
      {found > 0 && <p class="muted">{text.placedFrom}</p>}

      <div class="actions">
        {saveFailed && (
          <p class="notice" role="alert">
            {text.saveFailed}
          </p>
        )}
        <button
          type="button"
          class="button primary"
          disabled={saving}
          onClick={() => void openCampaign()}
        >
          {saving ? text.saving : text.openCampaign}
        </button>
        {report.mostlyNewParcelIds && !plan.isNewCampaign && (
          <button type="button" class="button" onClick={startNewCampaign}>
            {text.startNew}
          </button>
        )}
        <button type="button" class="button" onClick={leaveImport}>
          {strings.cancel}
        </button>
      </div>
    </main>
  );
}

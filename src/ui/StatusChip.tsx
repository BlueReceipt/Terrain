import { nowWithOffset } from '../data/clock.ts';
import type { HouseNumber } from '../domain/calls.ts';
import { chipTime, DEFAULT_DATE_FORMAT, fileDate } from '../domain/format.ts';
import { startStatus } from '../domain/statuses.ts';
import type { Row, Status } from '../domain/types.ts';
import { settings, statuses } from './flow.ts';
import { strings } from './strings.ts';
import { Swatch } from './Swatch.tsx';

export function statusOf(row: Row, all: readonly Status[]): Status {
  return all.find((status) => status.id === row.statusId) ?? startStatus(all);
}

/** The time if it was today, the date otherwise; a date typed in the file shows as typed. */
export function when(visitDate: string): string {
  const format = settings.value?.dateFormat ?? DEFAULT_DATE_FORMAT;
  return visitDate ? chipTime(visitDate, fileDate(nowWithOffset()), format) : '';
}

/** A status chip: color, label, and the time if marked today, the date otherwise. */
export function StatusChip({ row }: { row: Row }) {
  const status = statusOf(row, statuses.value);
  const time = when(row.visitDate);
  return (
    <span class="status-chip">
      <Swatch color={status.color} />
      <span>{status.label}</span>
      {time && <span class="muted">{time}</span>}
    </span>
  );
}

/** A number as the chooser names it: "Marie Trempette, cell 514-555-0199", "Home 450-555-0100". */
export function numberText(number: HouseNumber): string {
  return `${strings.calls.numberLabel(number.kind, number.owners)} ${number.display}`;
}

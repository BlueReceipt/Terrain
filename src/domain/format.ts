/**
 * Dates Terrain writes (Visit date, Call date, lot notes, note prefixes). Terrain stores the exact
 * time of the tap, ISO 8601 with the device's UTC offset, and shows it in the chosen format, so
 * changing the format later rewrites nothing. Dates typed in the client's file ("14.07",
 * "14 juillet") stay exactly as typed.
 */
export const DATE_FORMATS = ['DD.MM.YYYY HH:mm', 'YYYY-MM-DD HH:mm', 'DD/MM/YYYY HH:mm'] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];

/** Alex, 2026-10-01: "26.09.2026 plus time stamp". */
export const DEFAULT_DATE_FORMAT: DateFormat = 'DD.MM.YYYY HH:mm';

const TERRAIN_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Whether a cell holds a time Terrain wrote, rather than text from the client's file. */
export function isTerrainTime(value: string): boolean {
  return TERRAIN_TIME.test(value);
}

/**
 * "2026-09-26T14:32:05-04:00" → "26.09.2026 14:32": the wall-clock time where Alex tapped. The
 * format is a DateFormat, or part of one ("HH:mm").
 */
export function formatTime(iso: string, format: string): string {
  const match = TERRAIN_TIME.exec(iso);
  if (!match) return iso;
  const [, year = '', month = '', day = '', hour = '', minute = ''] = match;
  const parts: Record<string, string> = {
    YYYY: year,
    MM: month,
    DD: day,
    HH: hour,
    mm: minute,
  };
  return format.replace(/YYYY|MM|DD|HH|mm/g, (token) => parts[token] ?? token);
}

/** A cell as shown and exported: Terrain's times in the chosen format, anything else as typed. */
export function formatCell(value: string, format: DateFormat): string {
  return isTerrainTime(value) ? formatTime(value, format) : value;
}

/** "2026-10-01" from a Terrain time, for file names. */
export function fileDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * A status chip's time (§5.3): the time when it was today, the date otherwise. Text typed in the
 * client's file shows as typed.
 */
export function chipTime(value: string, today: string, format: DateFormat): string {
  if (!isTerrainTime(value)) return value;
  const [datePart = format, timePart = 'HH:mm'] = format.split(' ');
  return formatTime(value, fileDate(value) === today ? timePart : datePart);
}

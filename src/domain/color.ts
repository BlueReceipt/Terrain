import type { Status } from './types.ts';

/** KML writes colors as aabbggrr. */
export function kmlColorToHex(kml: string): string | null {
  const match = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(kml.trim());
  if (!match) return null;
  return `#${match[4] ?? ''}${match[3] ?? ''}${match[2] ?? ''}`.toUpperCase();
}

/** My Maps style ids embed the RGB hex: "icon-1899-0288D1" or "icon-1899-0288D1-normal". */
export function colorFromStyleId(styleId: string): string | null {
  const match = /-([0-9a-f]{6})(?:-|$)/i.exec(styleId);
  return match?.[1] ? `#${match[1].toUpperCase()}` : null;
}

export type ColorFamily =
  'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'black' | 'grey' | 'white';

function toHsl(hex: string): { h: number; s: number; l: number } {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * The color family of a pin, tuned on Alex's palette: his five greens (olive #AFB42B included)
 * mean "Given" and his four yellows "At door". Purple (Skipped) is a family of its own: none of
 * his 19 colors has a hue between 202° and 328°, so it takes none of his pins.
 */
export function colorFamily(hex: string): ColorFamily {
  const { h, s, l } = toHsl(hex);
  if (l < 0.18 || (s < 0.2 && l < 0.35)) return 'black';
  if (s < 0.2) return l > 0.85 ? 'white' : 'grey';
  if (h >= 35 && h < 60) return 'yellow';
  if (h >= 60 && h < 170) return 'green';
  if (h >= 170 && h < 260) return 'blue';
  if (h >= 260 && h < 320) return 'purple';
  return 'red';
}

/** WCAG relative luminance of a '#RRGGBB' color. */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** Black or white, whichever reads better on a status color. */
export function textOn(hex: string): '#000000' | '#FFFFFF' {
  const l = luminance(hex);
  // Contrast with black is (l + 0.05) / 0.05; with white, 1.05 / (l + 0.05).
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#FFFFFF';
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(toHsl(a).h - toHsl(b).h);
  return Math.min(d, 360 - d);
}

/** The status a pin color most likely means: the same color, else the only or nearest status of its family. */
export function suggestStatus(pinColor: string, statuses: readonly Status[]): Status | null {
  const active = statuses.filter((status) => !status.archived);
  const exact = active.find((status) => status.color.toUpperCase() === pinColor.toUpperCase());
  if (exact) return exact;
  const family = colorFamily(pinColor);
  const candidates = active.filter((status) => colorFamily(status.color) === family);
  let best: Status | null = null;
  for (const status of candidates) {
    if (!best || hueDistance(status.color, pinColor) < hueDistance(best.color, pinColor))
      best = status;
  }
  return best;
}

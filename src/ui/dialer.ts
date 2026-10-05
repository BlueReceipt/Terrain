declare global {
  interface Window {
    /** Stands in for the phone's dialer in the end-to-end tests: a test browser has none. */
    terrainDial?: (url: string) => void;
  }
}

/** Opens the phone's dialer on a number. */
export function openDialer(digits: string): void {
  const url = `tel:${digits}`;
  if (window.terrainDial) window.terrainDial(url);
  else window.location.href = url;
}

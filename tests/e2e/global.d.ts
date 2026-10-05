import type { Map } from 'maplibre-gl';

declare global {
  interface Window {
    /** The map, exposed by src/map/MapView.tsx so tests can find pins on screen. */
    terrainMap?: Map;
    /** Replaces the phone's dialer in tests (src/ui/dialer.ts). */
    terrainDial?: (url: string) => void;
    /** The tel: links the stand-in dialer received. */
    dialed?: string[];
    /** The vibrations the stand-in motor received. */
    buzzed?: (number | number[])[];
  }
}

export {};

import { FileSource, PMTiles, Protocol } from 'pmtiles';

export type MapLibre = typeof import('maplibre-gl');

const protocol = new Protocol();
let loading: Promise<MapLibre> | null = null;

/**
 * MapLibre, loaded once and only when the map shows. Its worker is bundled by Vite and served from
 * the app's own origin (the CSP allows nothing else), and pmtiles:// reads the offline map file.
 */
export function loadMapLibre(): Promise<MapLibre> {
  loading ??= (async () => {
    const [maplibre, worker] = await Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
    ]);
    maplibre.setWorkerUrl(worker.default);
    maplibre.addProtocol('pmtiles', protocol.tile);
    return maplibre;
  })();
  return loading;
}

/**
 * Makes the offline map file readable by the map; returns its source URL. The URL names the version
 * (when it was loaded), so a map loaded in its place draws fresh instead of from the old map's tiles.
 */
export function registerBasemap(file: File, version: string): string {
  const named = new File([file], `basemap-${version.replace(/[^0-9]/g, '')}.pmtiles`);
  const archive = new PMTiles(new FileSource(named));
  protocol.add(archive);
  return `pmtiles://${archive.source.getKey()}`;
}

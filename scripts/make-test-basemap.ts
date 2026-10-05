/**
 * Writes fixtures/public/test-basemap.pmtiles: a small synthetic basemap around the test fixtures'
 * first houses, in the Protomaps basemap layers, so tests can load an offline map without
 * downloading one (BUILD_SPEC §10, Phase 3). Its roads, water and places are invented or placed
 * roughly; the names carry French accents (É, ç, à) to check labels.
 * Run: npm run test-basemap
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeTile, EXTENT, type TileFeature, type TileGeometry, type TileLayer } from './mvt.ts';
import { tilesInBounds, writePmtiles, type TileInput } from './pmtiles.ts';

export const TEST_BASEMAP = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'public',
  'test-basemap.pmtiles',
);
export const TEST_BOUNDS: [number, number, number, number] = [-73.7, 45.2, -73.45, 45.33];
const MAX_ZOOM = 13;

type LngLat = [number, number];

interface SourceFeature {
  layer: string;
  properties: Record<string, string | number | boolean>;
  geometry:
    | { type: 'Point'; coordinates: LngLat }
    | { type: 'LineString'; coordinates: LngLat[] }
    | { type: 'Polygon'; coordinates: LngLat[] };
}

const named = (name: string) => ({ name, 'name:fr': name });

const FEATURES: SourceFeature[] = [
  {
    layer: 'earth',
    properties: { kind: 'earth' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [-74.5, 44.5],
        [-72.5, 44.5],
        [-72.5, 46],
        [-74.5, 46],
      ],
    },
  },
  {
    layer: 'water',
    properties: { kind: 'lake', ...named('Lac à la Truite'), min_zoom: 9 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [-73.545, 45.235],
        [-73.525, 45.232],
        [-73.515, 45.242],
        [-73.53, 45.25],
        [-73.548, 45.245],
      ],
    },
  },
  {
    layer: 'water',
    properties: { kind: 'river', ...named('Rivière de la Tortue'), min_zoom: 9 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-73.7, 45.29],
        [-73.64, 45.285],
        [-73.6, 45.295],
        [-73.55, 45.31],
        [-73.45, 45.32],
      ],
    },
  },
  {
    layer: 'roads',
    properties: { kind: 'minor_road', ...named('Rang Saint-Paul'), min_zoom: 12 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-73.68, 45.2642],
        [-73.6105, 45.2639],
        [-73.55, 45.2652],
      ],
    },
  },
  {
    layer: 'roads',
    properties: { kind: 'minor_road', ...named('Chemin du Lac'), min_zoom: 12 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-73.6105, 45.2639],
        [-73.6, 45.27],
        [-73.5925, 45.2722],
        [-73.57, 45.285],
      ],
    },
  },
  {
    layer: 'roads',
    properties: { kind: 'minor_road', ...named('Rang Saint-François'), min_zoom: 12 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-73.65, 45.22],
        [-73.64, 45.25],
        [-73.635, 45.3],
      ],
    },
  },
  {
    layer: 'roads',
    properties: { kind: 'major_road', ...named('Route 221'), ref: '221', min_zoom: 9 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-73.62, 45.2],
        [-73.6145, 45.2643],
        [-73.605, 45.33],
      ],
    },
  },
  {
    layer: 'roads',
    properties: { kind: 'highway', ...named('Autoroute 30'), ref: '30', min_zoom: 7 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-73.7, 45.31],
        [-73.6, 45.305],
        [-73.45, 45.29],
      ],
    },
  },
  ...(
    [
      ['Saint-Rémi', -73.6145, 45.2643, 10],
      ['Saint-Édouard', -73.5111, 45.2333, 8],
      ['Saint-Michel', -73.57, 45.2297, 8],
      ['Saint-Isidore', -73.68, 45.305, 8],
    ] as const
  ).map(([name, lng, lat, rank]): SourceFeature => ({
    layer: 'places',
    properties: { kind: 'locality', ...named(name), min_zoom: 8, population_rank: rank },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  })),
];

const LAYERS = ['earth', 'water', 'roads', 'places'];

/** Web Mercator: a position in units of tiles at zoom z. */
function project([lng, lat]: LngLat, z: number): [number, number] {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [
    ((lng + 180) / 360) * n,
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  ];
}

function inTile(feature: SourceFeature, z: number, x: number, y: number): TileGeometry {
  const toTile = (point: LngLat): [number, number] => {
    const [px, py] = project(point, z);
    return [Math.round((px - x) * EXTENT), Math.round((py - y) * EXTENT)];
  };
  const { geometry } = feature;
  if (geometry.type === 'Point') return { type: 'Point', points: [toTile(geometry.coordinates)] };
  if (geometry.type === 'LineString')
    return { type: 'LineString', lines: [geometry.coordinates.map(toTile)] };
  return { type: 'Polygon', rings: [geometry.coordinates.map(toTile)] };
}

export function testBasemap(): Uint8Array {
  const tiles: TileInput[] = [];
  for (let z = 0; z <= MAX_ZOOM; z++) {
    for (const { x, y } of tilesInBounds(TEST_BOUNDS, z)) {
      const layers: TileLayer[] = LAYERS.map((name) => ({
        name,
        features: FEATURES.filter((feature) => feature.layer === name).map(
          (feature): TileFeature => ({
            properties: feature.properties,
            geometry: inTile(feature, z, x, y),
          }),
        ),
      }));
      tiles.push({ z, x, y, data: encodeTile(layers) });
    }
  }
  return writePmtiles(tiles, {
    minZoom: 0,
    maxZoom: MAX_ZOOM,
    bounds: TEST_BOUNDS,
    centerZoom: 12,
    metadata: {
      name: 'Terrain test basemap',
      description:
        'Synthetic basemap for Terrain tests. Roads, water and places are invented or placed roughly.',
      attribution: 'Synthetic test data',
      vector_layers: LAYERS.map((id) => ({ id, fields: {} })),
    },
  });
}

function main(): void {
  const archive = testBasemap();
  writeFileSync(TEST_BASEMAP, archive);
  console.log(`Wrote ${String(archive.length)} bytes → ${TEST_BASEMAP}`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();

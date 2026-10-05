import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson';
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type { Pin } from '../domain/pins.ts';
import type { LatLng, ReferenceFeature } from '../domain/types.ts';
import { FONT_BOLD } from './style.ts';

const INK = '#000000';
const SHEET = '#FFFFFF';
const GRAPHITE = '#52564F';
const PIN_RADIUS = 12;

export const PINS = 'terrain-pins';
export const TETHER = 'terrain-tether';
export const ME = 'terrain-me';
export const ACCURACY = 'terrain-accuracy';
export const REFERENCE = 'terrain-reference';

/**
 * The file's lines, shapes and routes (boundaries, My Maps directions): a muted drawing under
 * the pins that nothing can tap (§5.2).
 */
export function referenceFeatures(reference: readonly ReferenceFeature[]): FeatureCollection {
  const ring = (points: readonly LatLng[]) => points.map((p) => [p.lng, p.lat]);
  return {
    type: 'FeatureCollection',
    features: reference.flatMap((feature): Feature[] => {
      const [first] = feature.rings;
      if (!first || first.length === 0) return [];
      let geometry: Geometry;
      if (feature.kind === 'point') {
        const [point] = first;
        if (!point) return [];
        geometry = { type: 'Point', coordinates: [point.lng, point.lat] };
      } else if (feature.kind === 'line') {
        geometry = { type: 'LineString', coordinates: ring(first) };
      } else {
        geometry = { type: 'Polygon', coordinates: feature.rings.map(ring) };
      }
      return [{ type: 'Feature', properties: { name: feature.name }, geometry }];
    }),
  };
}

type PointFeature = Feature<Point>;

/** Pins as map features: color, ring, badge, and whether the pin is selected or on the selected lots. */
export function pinFeatures(
  pins: readonly Pin[],
  selectedPinId: string | null,
  linkedPinIds: ReadonlySet<string>,
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin): PointFeature => ({
      type: 'Feature',
      id: pin.id,
      geometry: { type: 'Point', coordinates: [pin.position.lng, pin.position.lat] },
      properties: {
        id: pin.id,
        color: pin.color,
        ring: pin.ring,
        badge: pin.count > 1 ? String(pin.count) : '',
        houses: pin.houseKeys.length,
        selected: pin.id === selectedPinId,
        linked: linkedPinIds.has(pin.id) && pin.id !== selectedPinId,
      },
    })),
  };
}

/** The lot tether: a thin dashed line from the selected house to each house on its lots (§5.2). */
export function tetherFeatures(
  from: LatLng | null,
  to: readonly LatLng[],
): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: from
      ? to.map((end) => ({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [from.lng, from.lat],
              [end.lng, end.lat],
            ],
          },
        }))
      : [],
  };
}

/** The GPS dot and its accuracy ring, a circle in meters around it. */
export function meFeatures(me: { position: LatLng; accuracyM: number } | null): FeatureCollection {
  if (!me) return { type: 'FeatureCollection', features: [] };
  const { lat, lng } = me.position;
  const ring: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const angle = (i / 48) * 2 * Math.PI;
    ring.push([
      lng + (me.accuracyM * Math.cos(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
      lat + (me.accuracyM * Math.sin(angle)) / 111_320,
    ]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } },
    ],
  };
}

const isTrue = (property: string): ExpressionSpecification => ['==', ['get', property], true];

/**
 * Terrain's layers over the basemap (§9 pin styles): solid fill = marked here; thick ring with a
 * white center = closed from the lot; count badge = white numeral on ink; the selection ring is
 * 3 px white inside a 2 px ink outline, readable on every pin color, black included.
 */
export const TERRAIN_LAYERS: LayerSpecification[] = [
  {
    id: 'terrain-reference-fill',
    type: 'fill',
    source: REFERENCE,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': GRAPHITE, 'fill-opacity': 0.08 },
  },
  {
    id: 'terrain-reference-line',
    type: 'line',
    source: REFERENCE,
    filter: ['!=', ['geometry-type'], 'Point'],
    paint: { 'line-color': GRAPHITE, 'line-width': 2, 'line-opacity': 0.7 },
  },
  {
    id: 'terrain-reference-point',
    type: 'circle',
    source: REFERENCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 3, 'circle-color': GRAPHITE, 'circle-opacity': 0.7 },
  },
  {
    id: ACCURACY,
    type: 'fill',
    source: ME,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': INK, 'fill-opacity': 0.08 },
  },
  {
    id: TETHER,
    type: 'line',
    source: TETHER,
    paint: { 'line-color': INK, 'line-width': 1.5, 'line-dasharray': [3, 3] },
  },
  {
    id: 'terrain-ring-linked',
    type: 'circle',
    source: PINS,
    filter: isTrue('linked'),
    paint: {
      'circle-radius': PIN_RADIUS + 3,
      'circle-color': SHEET,
      'circle-stroke-color': INK,
      'circle-stroke-width': 1.5,
    },
  },
  {
    id: 'terrain-ring-selected',
    type: 'circle',
    source: PINS,
    filter: isTrue('selected'),
    paint: {
      'circle-radius': PIN_RADIUS + 4.5,
      'circle-color': SHEET,
      'circle-stroke-color': INK,
      'circle-stroke-width': 2,
    },
  },
  {
    id: PINS,
    type: 'circle',
    source: PINS,
    paint: {
      // A ring's 5 px stroke is drawn outside its radius: both styles end at the same size.
      'circle-radius': ['case', isTrue('ring'), PIN_RADIUS - 3.5, PIN_RADIUS],
      'circle-color': ['case', isTrue('ring'), SHEET, ['get', 'color']],
      'circle-stroke-color': ['case', isTrue('ring'), ['get', 'color'], INK],
      'circle-stroke-width': ['case', isTrue('ring'), 5, 1.5],
    },
  },
  {
    id: 'terrain-badges',
    type: 'circle',
    source: PINS,
    filter: ['!=', ['get', 'badge'], ''],
    paint: {
      'circle-radius': 9,
      'circle-color': INK,
      'circle-stroke-color': SHEET,
      'circle-stroke-width': 1.5,
      'circle-translate': [12, -12],
    },
  },
  {
    id: 'terrain-counts',
    type: 'symbol',
    source: PINS,
    filter: ['!=', ['get', 'badge'], ''],
    layout: {
      'text-field': ['get', 'badge'],
      'text-font': [FONT_BOLD],
      'text-size': 12,
      'text-offset': [1, -1],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': SHEET },
  },
  {
    id: ME,
    type: 'circle',
    source: ME,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 6,
      'circle-color': INK,
      'circle-stroke-color': SHEET,
      'circle-stroke-width': 3,
    },
  },
];

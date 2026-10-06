import type { Flavor } from '@protomaps/basemaps';
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';

/** The demo's online map: OpenFreeMap's tiles (OpenMapTiles schema), through the demo's relay. */
export const ONLINE = 'openfreemap';

const NAME: ExpressionSpecification = [
  'coalesce',
  ['get', 'name:fr'],
  ['get', 'name:latin'],
  ['get', 'name'],
];

const ofClass = (...classes: string[]): ExpressionSpecification => [
  'in',
  ['get', 'class'],
  ['literal', classes],
];

const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];

/** A width that grows with the zoom, as roads and rivers do on the offline map. */
const grows = (...stops: [number, number][]): ExpressionSpecification => [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  ...stops.flat(),
];

interface Label {
  id: string;
  sourceLayer: string;
  filter: ExpressionSpecification;
  font: string;
  size: number | ExpressionSpecification;
  color: string;
  halo: string;
  minzoom?: number;
  /** Written along the line (road names), not at a point. */
  along?: boolean;
}

/**
 * The online map's layers in the offline map's colors (the desaturated light flavor) and fonts, so
 * both look alike: land, wood and parks, water, buildings, roads, borders, then French names.
 */
export function onlineLayers(colors: Flavor, regular: string, bold: string): LayerSpecification[] {
  const source = ONLINE;
  const road = (
    id: string,
    classes: string[],
    color: string | ExpressionSpecification,
    width: ExpressionSpecification,
    minzoom: number,
  ): LayerSpecification => ({
    id,
    type: 'line',
    source,
    'source-layer': 'transportation',
    minzoom,
    filter: ['all', ofClass(...classes), notTunnel],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width },
  });
  const label = (name: Label): LayerSpecification => ({
    id: name.id,
    type: 'symbol',
    source,
    'source-layer': name.sourceLayer,
    minzoom: name.minzoom ?? 0,
    filter: name.filter,
    layout: {
      ...(name.along ? { 'symbol-placement': 'line' as const } : { 'text-max-width': 8 }),
      'text-field': NAME,
      'text-font': [name.font],
      'text-size': name.size,
    },
    paint: { 'text-color': name.color, 'text-halo-color': name.halo, 'text-halo-width': 1.5 },
  });
  const major = ['trunk', 'primary', 'secondary', 'tertiary'];
  return [
    { id: 'land', type: 'background', paint: { 'background-color': colors.earth } },
    {
      id: 'wood',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ofClass('wood', 'forest'),
      paint: { 'fill-color': colors.wood_a },
    },
    {
      id: 'grass',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ofClass('grass'),
      paint: { 'fill-color': colors.park_a },
    },
    {
      id: 'parks',
      type: 'fill',
      source,
      'source-layer': 'park',
      paint: { 'fill-color': colors.park_a },
    },
    {
      id: 'water',
      type: 'fill',
      source,
      'source-layer': 'water',
      filter: notTunnel,
      paint: { 'fill-color': colors.water },
    },
    {
      id: 'waterways',
      type: 'line',
      source,
      'source-layer': 'waterway',
      filter: notTunnel,
      paint: { 'line-color': colors.water, 'line-width': grows([9, 0.5], [18, 6]) },
    },
    {
      id: 'buildings',
      type: 'fill',
      source,
      'source-layer': 'building',
      minzoom: 13,
      paint: { 'fill-color': colors.buildings },
    },
    road('roads-other', ['service', 'track', 'path'], colors.other, grows([13, 0.5], [18, 5]), 13),
    road(
      'roads-minor',
      ['minor'],
      ['interpolate', ['linear'], ['zoom'], 12, colors.minor_a, 16, colors.minor_b],
      grows([11, 0.5], [18, 11]),
      11,
    ),
    road('roads-major-casing', major, colors.major_casing_early, grows([7, 1], [18, 15]), 7),
    road('roads-major', major, colors.major, grows([7, 0.5], [18, 12]), 7),
    road('highways-casing', ['motorway'], colors.highway_casing_early, grows([5, 1], [18, 17]), 5),
    road('highways', ['motorway'], colors.highway, grows([5, 0.5], [18, 14]), 5),
    road('railways', ['rail'], colors.railway, grows([10, 0.5], [18, 2]), 10),
    {
      id: 'borders',
      type: 'line',
      source,
      'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': colors.boundaries, 'line-width': 1, 'line-dasharray': [3, 2] },
    },
    label({
      id: 'water-names',
      sourceLayer: 'water_name',
      filter: ['has', 'name'],
      font: regular,
      size: 13,
      color: colors.ocean_label,
      halo: colors.earth,
    }),
    label({
      id: 'road-names',
      sourceLayer: 'transportation_name',
      filter: ofClass('motorway', 'minor', ...major),
      font: regular,
      size: 12,
      color: colors.roads_label_major,
      halo: colors.roads_label_major_halo,
      minzoom: 13,
      along: true,
    }),
    label({
      id: 'regions',
      sourceLayer: 'place',
      filter: ofClass('country', 'state', 'province'),
      font: regular,
      size: 12,
      color: colors.state_label,
      halo: colors.state_label_halo,
    }),
    label({
      id: 'villages',
      sourceLayer: 'place',
      filter: ofClass('village', 'hamlet', 'suburb', 'quarter', 'neighbourhood'),
      font: regular,
      size: ['match', ['get', 'class'], 'village', 13, 12],
      color: colors.subplace_label,
      halo: colors.subplace_label_halo,
      minzoom: 10,
    }),
    label({
      id: 'towns',
      sourceLayer: 'place',
      filter: ofClass('city', 'town'),
      font: bold,
      size: ['match', ['get', 'class'], 'city', 16, 14],
      color: colors.city_label,
      halo: colors.city_label_halo,
    }),
  ];
}

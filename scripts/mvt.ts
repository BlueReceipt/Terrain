/**
 * Encodes Mapbox Vector Tiles (https://github.com/mapbox/vector-tile-spec, version 2) for the
 * synthetic test basemap. Coordinates are in tile units (0 to 4096, y down).
 */
import { PbfWriter } from 'pbf';

export type TilePoint = [number, number];

export type TileGeometry =
  | { type: 'Point'; points: TilePoint[] }
  | { type: 'LineString'; lines: TilePoint[][] }
  | { type: 'Polygon'; rings: TilePoint[][] };

export interface TileFeature {
  properties: Record<string, string | number | boolean>;
  geometry: TileGeometry;
}

export interface TileLayer {
  name: string;
  features: TileFeature[];
}

export const EXTENT = 4096;

const MOVE_TO = 1;
const LINE_TO = 2;
const CLOSE_PATH = 7;
const command = (id: number, count: number) => (id & 0x7) | (count << 3);
const zigzag = (n: number) => (n << 1) ^ (n >> 31);

/** Twice the signed area by the surveyor's formula, y down: positive for an exterior ring. */
function ringArea(ring: readonly TilePoint[]): number {
  let sum = 0;
  ring.forEach(([x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % ring.length] ?? [x0, y0];
    sum += x0 * y1 - x1 * y0;
  });
  return sum;
}

function geometryOf(geometry: TileGeometry): { type: number; commands: number[] } {
  const commands: number[] = [];
  let cx = 0;
  let cy = 0;
  const moveTo = ([x, y]: TilePoint) => {
    commands.push(zigzag(x - cx), zigzag(y - cy));
    cx = x;
    cy = y;
  };
  if (geometry.type === 'Point') {
    commands.push(command(MOVE_TO, geometry.points.length));
    geometry.points.forEach(moveTo);
    return { type: 1, commands };
  }
  const parts = geometry.type === 'LineString' ? geometry.lines : geometry.rings;
  parts.forEach((part, i) => {
    let points = [...part];
    if (geometry.type === 'Polygon') {
      const first = points[0];
      const last = points.at(-1);
      if (first && last && first[0] === last[0] && first[1] === last[1])
        points = points.slice(0, -1);
      // The first ring is the exterior (clockwise on screen), the others are holes.
      const exterior = i === 0;
      if (ringArea(points) > 0 !== exterior) points.reverse();
    }
    const [start, ...rest] = points;
    if (!start) return;
    commands.push(command(MOVE_TO, 1));
    moveTo(start);
    commands.push(command(LINE_TO, rest.length));
    rest.forEach(moveTo);
    if (geometry.type === 'Polygon') commands.push(command(CLOSE_PATH, 1));
  });
  return { type: geometry.type === 'LineString' ? 2 : 3, commands };
}

function writeValue(value: string | number | boolean, pbf: PbfWriter): void {
  if (typeof value === 'string') pbf.writeStringField(1, value);
  else if (typeof value === 'boolean') pbf.writeBooleanField(7, value);
  else if (Number.isInteger(value)) pbf.writeSVarintField(6, value);
  else pbf.writeDoubleField(3, value);
}

function writeLayer(layer: TileLayer, pbf: PbfWriter): void {
  const keys: string[] = [];
  const values: (string | number | boolean)[] = [];
  const keyIndex = new Map<string, number>();
  const valueIndex = new Map<string, number>();
  pbf.writeVarintField(15, 2);
  pbf.writeStringField(1, layer.name);
  for (const feature of layer.features) {
    const tags: number[] = [];
    for (const [key, value] of Object.entries(feature.properties)) {
      let k = keyIndex.get(key);
      if (k === undefined) {
        k = keys.push(key) - 1;
        keyIndex.set(key, k);
      }
      const valueKey = `${typeof value}:${String(value)}`;
      let v = valueIndex.get(valueKey);
      if (v === undefined) {
        v = values.push(value) - 1;
        valueIndex.set(valueKey, v);
      }
      tags.push(k, v);
    }
    const { type, commands } = geometryOf(feature.geometry);
    pbf.writeMessage(
      2,
      (_: null, out: PbfWriter) => {
        out.writePackedVarint(2, tags);
        out.writeVarintField(3, type);
        out.writePackedVarint(4, commands);
      },
      null,
    );
  }
  for (const key of keys) pbf.writeStringField(3, key);
  for (const value of values) pbf.writeMessage(4, writeValue, value);
  pbf.writeVarintField(5, EXTENT);
}

export function encodeTile(layers: readonly TileLayer[]): Uint8Array {
  const pbf = new PbfWriter();
  for (const layer of layers) {
    if (layer.features.length > 0) pbf.writeMessage(3, writeLayer, layer);
  }
  return pbf.finish();
}

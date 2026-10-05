import { strFromU8, unzipSync } from 'fflate';
import { colorFromStyleId, kmlColorToHex } from './color.ts';
import { detectRoles } from './columns.ts';
import { ImportError } from './errors.ts';
import type { IncomingRow, LatLng, ParsedFile, ReferenceFeature } from './types.ts';

/** The DOM subset the parser reads. The browser's DOMParser and @xmldom/xmldom both provide it. */
export interface XmlNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly localName?: string | null;
  readonly childNodes: ArrayLike<XmlNode>;
  readonly textContent: string | null;
  getAttribute?(name: string): string | null;
}

export type ParseXml = (text: string) => XmlNode;

const ELEMENT_NODE = 1;

function tagOf(node: XmlNode): string {
  const name = node.localName ?? node.nodeName;
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

function elements(node: XmlNode, tag?: string): XmlNode[] {
  const found: XmlNode[] = [];
  const nodes = node.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    if (child?.nodeType === ELEMENT_NODE && (tag === undefined || tagOf(child) === tag)) {
      found.push(child);
    }
  }
  return found;
}

function first(node: XmlNode | undefined, tag: string): XmlNode | undefined {
  return node ? elements(node, tag)[0] : undefined;
}

function descendants(node: XmlNode, tag: string, found: XmlNode[] = []): XmlNode[] {
  for (const child of elements(node)) {
    if (tagOf(child) === tag) found.push(child);
    descendants(child, tag, found);
  }
  return found;
}

function textOf(node: XmlNode | undefined): string {
  return node?.textContent ?? '';
}

function attribute(node: XmlNode, name: string): string {
  return node.getAttribute?.(name) ?? '';
}

function parseCoordinates(text: string): LatLng[] {
  const positions: LatLng[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    const [lng, lat] = tuple.split(',').map(Number);
    if (lng !== undefined && lat !== undefined && Number.isFinite(lng) && Number.isFinite(lat)) {
      positions.push({ lat, lng });
    }
  }
  return positions;
}

/** styleUrl → StyleMap (normal) → Style → IconStyle color; the RGB in My Maps style ids as fallback. */
function styleColors(root: XmlNode): (styleUrl: string) => string | null {
  const colors = new Map<string, string>();
  for (const style of descendants(root, 'Style')) {
    const id = attribute(style, 'id');
    if (!id) continue;
    const kml = textOf(first(first(style, 'IconStyle'), 'color')).trim();
    const hex = (kml ? kmlColorToHex(kml) : null) ?? colorFromStyleId(id);
    if (hex) colors.set(id, hex);
  }
  const normalStyle = new Map<string, string>();
  for (const map of descendants(root, 'StyleMap')) {
    for (const pair of elements(map, 'Pair')) {
      if (textOf(first(pair, 'key')).trim() === 'normal') {
        normalStyle.set(
          attribute(map, 'id'),
          textOf(first(pair, 'styleUrl')).trim().replace(/^#/, ''),
        );
      }
    }
  }
  return (styleUrl) => {
    const id = styleUrl.trim().replace(/^#/, '');
    if (!id) return null;
    const resolved = normalStyle.get(id) ?? id;
    return colors.get(resolved) ?? colorFromStyleId(resolved) ?? colorFromStyleId(id);
  };
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return HTML_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/** Without ExtendedData, My Maps' description ("Column: value<br>...") is the only copy of the data. */
function fieldsFromDescription(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of html.split(/<br\s*\/?>/i)) {
    const text = decodeHtml(line.replace(/<[^>]*>/g, ''));
    const colon = text.indexOf(':');
    if (colon > 0) fields[text.slice(0, colon).trim()] = text.slice(colon + 1).trim();
  }
  return fields;
}

interface Geometry {
  point: LatLng | null;
  lines: LatLng[][];
  polygons: LatLng[][][];
}

function geometryOf(
  node: XmlNode,
  into: Geometry = { point: null, lines: [], polygons: [] },
): Geometry {
  for (const child of elements(node)) {
    const tag = tagOf(child);
    if (tag === 'Point') {
      into.point ??= parseCoordinates(textOf(first(child, 'coordinates')))[0] ?? null;
    } else if (tag === 'LineString' || tag === 'LinearRing') {
      into.lines.push(parseCoordinates(textOf(first(child, 'coordinates'))));
    } else if (tag === 'Polygon') {
      const rings = [
        ...elements(child, 'outerBoundaryIs'),
        ...elements(child, 'innerBoundaryIs'),
      ].map((boundary) =>
        parseCoordinates(textOf(first(first(boundary, 'LinearRing'), 'coordinates'))),
      );
      into.polygons.push(rings);
    } else if (tag === 'MultiGeometry') {
      geometryOf(child, into);
    }
  }
  return into;
}

const DIRECTIONS_LAYER = /^directions from /i;

export function parseKml(text: string, parseXml: ParseXml, fileName: string): ParsedFile {
  let document: XmlNode;
  try {
    document = parseXml(text);
  } catch {
    throw new ImportError('not-kml');
  }
  const kml = elements(document).find((node) => tagOf(node) === 'kml');
  if (!kml || descendants(document, 'parsererror').length > 0) throw new ImportError('not-kml');

  const colorOf = styleColors(kml);
  const columns: string[] = [];
  const seenColumns = new Set<string>();
  const layers: string[] = [];
  const rows: IncomingRow[] = [];
  const reference: ReferenceFeature[] = [];

  const readPlacemark = (placemark: XmlNode, layer: string, isReference: boolean): void => {
    const name = textOf(first(placemark, 'name')).trim();
    const geometry = geometryOf(placemark);
    if (isReference || geometry.lines.length > 0 || geometry.polygons.length > 0) {
      for (const line of geometry.lines)
        reference.push({ layer, name, kind: 'line', rings: [line] });
      for (const rings of geometry.polygons)
        reference.push({ layer, name, kind: 'polygon', rings });
      if (
        geometry.point &&
        (isReference || (geometry.lines.length === 0 && geometry.polygons.length === 0))
      ) {
        reference.push({ layer, name, kind: 'point', rings: [[geometry.point]] });
      }
      return;
    }

    const extended = first(placemark, 'ExtendedData');
    let fields: Record<string, string>;
    if (extended) {
      fields = {};
      for (const data of elements(extended, 'Data')) {
        const column = attribute(data, 'name');
        if (column) fields[column] = textOf(first(data, 'value'));
      }
      for (const schemaData of elements(extended, 'SchemaData')) {
        for (const simple of elements(schemaData, 'SimpleData')) {
          const column = attribute(simple, 'name');
          if (column) fields[column] = textOf(simple);
        }
      }
    } else {
      fields = fieldsFromDescription(textOf(first(placemark, 'description')));
    }
    for (const column of Object.keys(fields)) {
      if (!seenColumns.has(column)) {
        seenColumns.add(column);
        columns.push(column);
      }
    }
    if (!layers.includes(layer)) layers.push(layer);
    const address = textOf(first(placemark, 'address')).trim();
    rows.push({
      sourceIndex: rows.length,
      layer,
      parcelIdRaw: name,
      fields,
      position: geometry.point,
      addressText: geometry.point || !address ? null : address,
      pinColor: colorOf(textOf(first(placemark, 'styleUrl'))),
    });
  };

  const walk = (node: XmlNode, layer: string, isReference: boolean): void => {
    for (const child of elements(node)) {
      const tag = tagOf(child);
      if (tag === 'Placemark') {
        readPlacemark(child, layer, isReference);
      } else if (tag === 'Folder') {
        // Each top-level folder is one My Maps layer; nested folders stay in their layer.
        const folderName = textOf(first(child, 'name')).trim() || layer;
        const isTopLevel = layer === '';
        const nextLayer = isTopLevel ? folderName : layer;
        walk(child, nextLayer, isReference || DIRECTIONS_LAYER.test(folderName));
      } else if (tag === 'Document') {
        walk(child, layer, isReference);
      }
    }
  };
  walk(kml, '', false);

  const layerNameForLooseRows = textOf(first(first(kml, 'Document'), 'name')).trim() || fileName;
  for (const row of rows) {
    if (row.layer === '') row.layer = layerNameForLooseRows;
  }
  if (layers.includes('')) layers.splice(layers.indexOf(''), 1, layerNameForLooseRows);

  if (rows.length === 0) {
    throw new ImportError(
      descendants(kml, 'NetworkLink').length > 0 ? 'network-link-only' : 'no-rows',
    );
  }
  // The parcel ID is each pin's title (Appendix A): no column plays that part in a KMZ.
  const roles = Object.fromEntries(
    Object.entries(detectRoles(columns)).filter(([role]) => role !== 'parcelId'),
  );
  return { fileName, format: 'kml', columns, layers, rows, reference, roles };
}

export function parseKmz(bytes: Uint8Array, parseXml: ParseXml, fileName: string): ParsedFile {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ImportError('damaged-kmz');
  }
  const names = Object.keys(entries);
  const kmlName =
    names.find((name) => name.toLowerCase() === 'doc.kml') ??
    names.find((name) => name.toLowerCase().endsWith('.kml'));
  const kml = kmlName === undefined ? undefined : entries[kmlName];
  if (!kml) throw new ImportError('no-kml-in-kmz');
  return parseKml(strFromU8(kml), parseXml, fileName);
}

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ImportError } from '../../src/domain/errors.ts';
import { parseKml, parseKmz } from '../../src/domain/kml.ts';
import { parseXml } from '../support/xml.ts';

const kml = (body: string, styles = '') => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Poutine sample</name>${styles}${body}</Document></kml>`;

const data = (fields: Record<string, string>) =>
  `<ExtendedData>${Object.entries(fields)
    .map(([name, value]) => `<Data name="${name}"><value>${value}</value></Data>`)
    .join('')}</ExtendedData>`;

const MY_MAPS_STYLES = `
  <Style id="icon-1899-0288D1-normal"><IconStyle><color>ffd18802</color></IconStyle></Style>
  <Style id="icon-1899-0288D1-highlight"><IconStyle><color>ffd18802</color></IconStyle></Style>
  <StyleMap id="icon-1899-0288D1">
    <Pair><key>normal</key><styleUrl>#icon-1899-0288D1-normal</styleUrl></Pair>
    <Pair><key>highlight</key><styleUrl>#icon-1899-0288D1-highlight</styleUrl></Pair>
  </StyleMap>`;

const parse = (text: string) => parseKml(text, parseXml, 'test.kml');

describe('KML parsing', () => {
  it('reads layers, parcel IDs, columns in order and positions', () => {
    const file = parse(
      kml(`
        <Folder><name>Casse-croûtes.xlsx</name>
          <Placemark><name>P1-095B</name>${data({ NOM: 'Sauceau', ADRESSE: '60, rue Sainte-Anne' })}
            <Point><coordinates>-73.8723,45.3155,0</coordinates></Point></Placemark>
          <Placemark><name>P1-096</name>${data({ NOM: 'Vinaigre', TEL_RES: '450 555-0142', ADRESSE: '903, rue Fleury Ouest' })}
            <Point><coordinates>-73.80,45.30,0</coordinates></Point></Placemark>
        </Folder>
        <Folder><name>Poutine et patates.xlsx</name>
          <Placemark><name>PT9-020</name>${data({ NOM: 'Tartiflette' })}<Point><coordinates>-73.6,45.2</coordinates></Point></Placemark>
        </Folder>`),
    );
    expect(file.layers).toEqual(['Casse-croûtes.xlsx', 'Poutine et patates.xlsx']);
    expect(file.columns).toEqual(['NOM', 'ADRESSE', 'TEL_RES']);
    expect(file.rows.map((row) => row.parcelIdRaw)).toEqual(['P1-095B', 'P1-096', 'PT9-020']);
    expect(file.rows.map((row) => row.sourceIndex)).toEqual([0, 1, 2]);
    expect(file.rows[0]?.position).toEqual({ lat: 45.3155, lng: -73.8723 });
    expect(file.rows[2]?.layer).toBe('Poutine et patates.xlsx');
  });

  it('decodes accents and HTML entities', () => {
    const file = parse(
      kml(
        `<Placemark><name>P1-099</name>${data({
          NOM: 'Lafromagé &amp; fils',
          Notes: 'Propriétaire unique, ya une terrasse &lt;patio&gt;',
          MUNICIPALITE: 'Saint-&#201;lie-de-Caxton',
        })}<Point><coordinates>-73.8,45.3</coordinates></Point></Placemark>`,
      ),
    );
    expect(file.rows[0]?.fields).toEqual({
      NOM: 'Lafromagé & fils',
      Notes: 'Propriétaire unique, ya une terrasse <patio>',
      MUNICIPALITE: 'Saint-Élie-de-Caxton',
    });
  });

  it('keeps empty values and multi-line cells exactly', () => {
    const file = parse(
      kml(`<Placemark><name>P1-096
P1-097</name>${data({ TEL_BUR: '', CELLULAIRE: '514 555-0144\nNathalie (gérante) 450-555-0143' })}
        <Point><coordinates>-73.8,45.3</coordinates></Point></Placemark>`),
    );
    expect(file.rows[0]?.parcelIdRaw).toBe('P1-096\nP1-097');
    expect(file.rows[0]?.fields).toEqual({
      TEL_BUR: '',
      CELLULAIRE: '514 555-0144\nNathalie (gérante) 450-555-0143',
    });
  });

  it('reads the description when ExtendedData is missing', () => {
    const file = parse(
      kml(`<Placemark><name>P1-100</name>
        <description><![CDATA[NOM: Vinaigre<br>ADRESSE: 903, rue Fleury Ouest<br>Notes: L&#39;arbre]]></description>
        <Point><coordinates>-73.8,45.3</coordinates></Point></Placemark>`),
    );
    expect(file.rows[0]?.fields).toEqual({
      NOM: 'Vinaigre',
      ADRESSE: '903, rue Fleury Ouest',
      Notes: "L'arbre",
    });
  });

  it('imports My Maps address-only pins without a position, keeping their address', () => {
    const file = parse(
      kml(
        `<Folder><name>Layer</name><Placemark><name>P1-095B</name>
          <address>60, rue Sainte-Anne Amqui (Québec) G5J 2G2</address>
          <styleUrl>#icon-1899-0288D1</styleUrl>${data({ NOM: 'Sauceau' })}</Placemark>
          <Placemark><name>P1-139</name>${data({ Notes: 'À valider avec le gérant' })}</Placemark></Folder>`,
        MY_MAPS_STYLES,
      ),
    );
    expect(file.rows).toHaveLength(2);
    expect(file.rows[0]).toMatchObject({
      position: null,
      addressText: '60, rue Sainte-Anne Amqui (Québec) G5J 2G2',
      pinColor: '#0288D1',
    });
    expect(file.rows[1]).toMatchObject({ position: null, addressText: null, pinColor: null });
  });

  it('resolves pin colors through StyleMap, and from the style id when the color is missing', () => {
    const file = parse(
      kml(
        `<Placemark><name>A</name><styleUrl>#icon-1899-0288D1</styleUrl><Point><coordinates>-73,45</coordinates></Point></Placemark>
         <Placemark><name>B</name><styleUrl>#icon-1899-7CB342</styleUrl><Point><coordinates>-73,45</coordinates></Point></Placemark>`,
        MY_MAPS_STYLES,
      ),
    );
    expect(file.rows.map((row) => row.pinColor)).toEqual(['#0288D1', '#7CB342']);
  });

  it('sends lines, polygons and My Maps directions to the reference overlay', () => {
    const file = parse(
      kml(`
        <Folder><name>Layer</name>
          <Placemark><name>Trail</name><LineString><coordinates>-73,45 -73.1,45.1</coordinates></LineString></Placemark>
          <Placemark><name>Parcel</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-73,45 -73.1,45 -73.1,45.1 -73,45</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
          <Placemark><name>P1-001</name><Point><coordinates>-73,45</coordinates></Point></Placemark>
        </Folder>
        <Folder><name>Directions from P9-118 to P9-118</name>
          <Placemark><name>P9-118</name><styleUrl>#icon-ci-22-nodesc</styleUrl><Point><coordinates>-72.5,46.3</coordinates></Point></Placemark>
          <Placemark><name>Route</name><LineString><coordinates>-72.5,46.3 -72.6,46.4</coordinates></LineString></Placemark>
        </Folder>`),
    );
    expect(file.rows.map((row) => row.parcelIdRaw)).toEqual(['P1-001']);
    expect(file.layers).toEqual(['Layer']);
    expect(file.reference.map((feature) => [feature.layer, feature.kind])).toEqual([
      ['Layer', 'line'],
      ['Layer', 'polygon'],
      ['Directions from P9-118 to P9-118', 'point'],
      ['Directions from P9-118 to P9-118', 'line'],
    ]);
  });

  it('puts placemarks outside folders in a layer named after the document', () => {
    const file = parse(
      kml(
        '<Placemark><name>P1-001</name><Point><coordinates>-73,45</coordinates></Point></Placemark>',
      ),
    );
    expect(file.layers).toEqual(['Poutine sample']);
    expect(file.rows[0]?.layer).toBe('Poutine sample');
  });

  it('explains a network-link-only file instead of importing nothing', () => {
    const linkOnly = kml(
      '<NetworkLink><name>Poutine sample</name><Link><href>https://www.google.com/maps/d/kml?mid=x</href></Link></NetworkLink>',
    );
    // The link goes along: on the public demo, Terrain opens that map through its relay.
    expect(() => parse(linkOnly)).toThrow(
      expect.objectContaining({
        code: 'network-link-only',
        link: 'https://www.google.com/maps/d/kml?mid=x',
      }) as Error,
    );
  });

  it('rejects text that is not KML', () => {
    expect(() => parse('<html><body>hello</body></html>')).toThrow(ImportError);
  });
});

describe('KMZ', () => {
  const body = kml(
    '<Placemark><name>P1-001</name><Point><coordinates>-73,45</coordinates></Point></Placemark>',
  );

  it('reads doc.kml from the zip, with its images alongside', () => {
    const zip = zipSync({
      'doc.kml': strToU8(body),
      'images/icon-1.png': new Uint8Array([1, 2, 3]),
    });
    expect(parseKmz(zip, parseXml, 'map.kmz').rows).toHaveLength(1);
  });

  it('reads another .kml name when doc.kml is absent', () => {
    const zip = zipSync({ 'export.kml': strToU8(body) });
    expect(parseKmz(zip, parseXml, 'map.kmz').rows).toHaveLength(1);
  });

  it('explains a damaged file and a zip without a map', () => {
    expect(() => parseKmz(new Uint8Array([1, 2, 3]), parseXml, 'x.kmz')).toThrow(
      expect.objectContaining({ code: 'damaged-kmz' }) as Error,
    );
    expect(() => parseKmz(zipSync({ 'a.txt': strToU8('hi') }), parseXml, 'x.kmz')).toThrow(
      expect.objectContaining({ code: 'no-kml-in-kmz' }) as Error,
    );
  });
});

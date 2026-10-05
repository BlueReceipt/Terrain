/**
 * Writes the synthetic fixtures in fixtures/public/. Every owner, phone, parcel and
 * address is invented, in towns that have a poutine place in restaurants.json.
 * Run: npm run fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import * as XLSX from 'xlsx';

const OUT = join(import.meta.dirname, '..', 'fixtures', 'public');

export const COLUMNS = [
  'Contact person',
  'Contact number',
  'Notes',
  'Anc_lot',
  'NUM_LOT',
  'Propriétaire',
  'APPEL',
  'PRENOM',
  'NOM',
  'ADRESSE',
  'MUNICIPALITE',
  'PROVINCE',
  'CODE_POSTAL',
  'TEL_RES',
  'CELLULAIRE',
  'TEL_BUR',
  'TELECOPIEUR',
  'COURRIEL',
  'Visit date',
  'Package status',
  'Call date',
  'call result',
  'Row location',
  'Language',
] as const;

type Fields = Partial<Record<(typeof COLUMNS)[number], string>>;

export interface CaseRow {
  name: string;
  fields: Fields;
  /** [lng, lat]; absent means My Maps placed the pin from its address and exported no coordinates. */
  point?: [number, number];
  color: string;
  /** Written as a description only, without ExtendedData. */
  descriptionOnly?: boolean;
}

// The My Maps pin colors Alex uses.
const BLUE = '#0288D1';
const GREEN = '#7CB342';
const GREEN_2 = '#0F9D58';
const OLIVE = '#AFB42B';
const YELLOW = '#FFEA00';
const YELLOW_2 = '#FBC02D';
const BLACK = '#000000';
const RED = '#C2185B';
const GREY = '#757575';

const TREMPETTE_HOME = [-73.6105, 45.2641] as const;
const VILLAGE_CENTER = [-73.5302, 45.2803] as const;

const addr = (adresse: string, municipalite: string, codePostal: string): Fields => ({
  ADRESSE: adresse,
  MUNICIPALITE: municipalite,
  PROVINCE: '(Québec)',
  CODE_POSTAL: codePostal,
});

const near = (
  [lng, lat]: readonly [number, number],
  eastMeters: number,
  northMeters: number,
): [number, number] => [
  lng + eastMeters / (111_320 * Math.cos((lat * Math.PI) / 180)),
  lat + northMeters / 111_320,
];

/** Every house and lot case Terrain must handle, plus quirks seen in real My Maps exports. */
export const CASES: CaseRow[] = [
  // Husband and wife on one parcel ID, different cells, shared home line; the owner's second parcel at the same door.
  {
    name: 'P1-216B',
    fields: {
      APPEL: 'Monsieur',
      PRENOM: 'Alain',
      NOM: 'Trempette',
      ...addr('123, rue Saint-Paul', 'Saint-Roch-des-Aulnaies', 'G0R 4E0'),
      TEL_RES: '450 555-0100',
      CELLULAIRE: '450 555-0123',
      NUM_LOT: '1 234 500',
    },
    point: [...TREMPETTE_HOME],
    color: BLUE,
  },
  {
    name: 'P1-216B',
    fields: {
      APPEL: 'Madame',
      PRENOM: 'Marie',
      NOM: 'Trempette',
      ...addr('123, rue Saint-Paul', 'Saint-Roch-des-Aulnaies', 'G0R 4E0'),
      TEL_RES: '450 555-0100',
      CELLULAIRE: '514 555-0199',
      NUM_LOT: '1 234 500',
    },
    point: near(TREMPETTE_HOME, 20, 0),
    color: BLUE,
  },
  {
    name: 'P1-217A',
    fields: {
      APPEL: 'Monsieur',
      PRENOM: 'Alain',
      NOM: 'Trempette',
      ...addr('123, rue Saint-Paul', 'Saint-Roch-des-Aulnaies', 'G0R 4E0'),
      TEL_RES: '450 555-0100',
      CELLULAIRE: '450 555-0123',
      NUM_LOT: '1 234 501',
    },
    point: near(TREMPETTE_HOME, 0, 25),
    color: BLUE,
  },
  // A co-owner of P1-216B at another address.
  {
    name: 'P1-216B',
    fields: {
      APPEL: 'Monsieur',
      PRENOM: 'Luc',
      NOM: 'Trempette',
      ...addr('12, chemin du Lac', 'Saint-Roch-des-Aulnaies', 'G0R 4E0'),
      CELLULAIRE: '450 555-0177',
      NUM_LOT: '1 234 500',
    },
    point: near(TREMPETTE_HOME, 1400, 900),
    color: BLUE,
  },
  // One address typed two ways.
  {
    name: 'P1-220',
    fields: {
      APPEL: 'Madame',
      PRENOM: 'Sylvie',
      NOM: 'Grains',
      ...addr('45 avenue St-Joseph', 'Saint-Louis-de-Blandford', 'G0Z 1B0'),
      NUM_LOT: '1 234 520',
    },
    point: [-73.5701, 45.2402],
    color: GREEN,
  },
  {
    name: 'P1-221',
    fields: {
      APPEL: 'Monsieur',
      PRENOM: 'René',
      NOM: 'Grains',
      ...addr('45, avenue Saint-Joseph', 'Saint-Louis-de-Blandford', 'G0Z 1B0'),
      NUM_LOT: '1 234 521',
      'Package status': 'Given to wife',
      'Visit date': '14 juillet',
    },
    point: near([-73.5701, 45.2402], 30, 10),
    color: GREEN_2,
  },
  // Two different addresses geocoded to one point (a village-center fallback).
  {
    name: 'P1-222',
    fields: {
      PRENOM: 'Paul',
      NOM: 'Rôti',
      ...addr('10, rue Principale', 'Saint-Louis-de-Blandford', 'G0Z 1B0'),
      NUM_LOT: '1 234 522',
    },
    point: [...VILLAGE_CENTER],
    color: YELLOW,
  },
  {
    name: 'P1-223',
    fields: {
      PRENOM: 'Anne',
      NOM: 'Rôti',
      ...addr('22, rue Principale', 'Saint-Louis-de-Blandford', 'G0Z 1B0'),
      NUM_LOT: '1 234 523',
      'Package status': 'At door',
    },
    point: [...VILLAGE_CENTER],
    color: YELLOW_2,
  },
  // Lots that group only by NUM_LOT, written with and without spaces, at two houses.
  {
    name: 'P1-230',
    fields: {
      PRENOM: 'Guy',
      NOM: 'Brunsauce',
      ...addr('870, montée de Cazaville', 'Saint-Anicet', 'J0S 1B0'),
      NUM_LOT: '1 234 567',
    },
    point: [-73.1101, 45.2301],
    color: OLIVE,
  },
  {
    name: 'P1-231',
    fields: {
      PRENOM: 'Manon',
      NOM: 'Brunsauce',
      ...addr('25, route 125', 'Rawdon', 'J0K 1S0'),
      NUM_LOT: '1234567',
    },
    point: [-73.2501, 45.4401],
    color: GREEN,
  },
  // Blank NUM_LOT values never group.
  {
    name: 'P1-232',
    fields: {
      PRENOM: 'Yvon',
      NOM: 'Rissolé',
      ...addr('646, montée de Cazaville', 'Saint-Anicet', 'J0S 1B0'),
      NUM_LOT: '',
    },
    point: [-73.1201, 45.2311],
    color: BLUE,
  },
  {
    name: 'P1-233',
    fields: {
      PRENOM: 'Pierre',
      NOM: 'Brunsauce',
      ...addr('1123, montée de Cazaville', 'Saint-Anicet', 'J0S 1B0'),
      NUM_LOT: '',
    },
    point: [-73.1301, 45.2321],
    color: BLUE,
  },
  // A blank address.
  {
    name: 'P1-234',
    fields: {
      Propriétaire: 'Casse-croûte Sans Adresse inc.',
      NUM_LOT: '1 234 534',
      Notes: 'À valider avec le gérant',
    },
    point: [-73.1401, 45.2331],
    color: GREY,
  },
  // Address-only pins: My Maps exported no coordinates. Two owners at one door.
  {
    name: 'P1-235',
    fields: {
      APPEL: 'Monsieur',
      PRENOM: 'Michel',
      NOM: 'Saucier',
      ...addr('60, rue Sainte-Anne', 'Amqui', 'G5J 2G2'),
      NUM_LOT: '1 234 535',
    },
    color: BLUE,
  },
  {
    name: 'P1-235',
    fields: {
      APPEL: 'Madame',
      PRENOM: 'Lise',
      NOM: 'Saucier',
      ...addr('60, rue Ste-Anne', 'Amqui', 'G5J 2G2'),
      NUM_LOT: '1 234 535',
    },
    color: BLUE,
  },
  // The client's mix: town, QC and postal code in MUNICIPALITE, the parcel's town in CODE_POSTAL.
  {
    name: 'P08-095',
    fields: {
      PRENOM: 'Céline',
      NOM: 'Cheddar',
      ADRESSE: '420, avenue Hamford',
      MUNICIPALITE: 'Lachute QC J8H 3P1',
      CODE_POSTAL: 'Val-Brillant',
      NUM_LOT: '1 235 128',
    },
    color: BLUE,
  },
  {
    name: 'P08-096',
    fields: {
      PRENOM: 'Céline',
      NOM: 'Cheddar',
      ...addr('420 avenue Hamford', 'Lachute', 'J8H 3P1'),
      NUM_LOT: '1 235 129',
    },
    color: BLUE,
  },
  // Same street, another town: another house.
  {
    name: 'P08-097',
    fields: {
      PRENOM: 'Denis',
      NOM: 'Lapatate',
      ...addr('420, avenue Hamford', 'Saint-Isidore', 'J0L 2A0'),
      NUM_LOT: '1 235 130',
    },
    color: BLUE,
  },
  // A cell with an old (crossed-out) ID next to the new one, and someone else still listed on the old ID.
  {
    name: 'P08-132A\nP08-132',
    fields: {
      PRENOM: 'Rita',
      NOM: 'Poutini',
      ...addr('511, route 132 Est', 'Val-Brillant', 'G0J 3L0'),
      NUM_LOT: '1 235 140',
    },
    point: [-72.8201, 46.2701],
    color: BLACK,
  },
  {
    name: 'P08-132A',
    fields: {
      PRENOM: 'Umberto',
      NOM: 'Poutini',
      ...addr('58, boulevard Thibeau', 'Trois-Rivières', 'G8T 7A6'),
      NUM_LOT: '1 235 141',
    },
    point: [-72.5501, 46.3401],
    color: RED,
  },
  // Accents and HTML entities; a single-owner parcel (renamed in cases-renamed.kmz).
  {
    name: 'P1-240',
    fields: {
      Propriétaire: 'Lafromagé & fils',
      PRENOM: 'Jean',
      NOM: 'Trempoté',
      ...addr('7, avenue Principale', 'Saint-Élie-de-Caxton', 'G0X 2N0'),
      NUM_LOT: '1 234 540',
      Notes: 'Propriétaire unique, terrasse sur le côté',
      'Call date': '28 septembre',
      'call result': 'voicemail',
    },
    point: [-73.8801, 45.2601],
    color: GREEN_2,
  },
  // Only a description, no ExtendedData.
  {
    name: 'P1-241',
    fields: {
      PRENOM: 'Luce',
      NOM: 'Moutarde',
      ...addr('3, route Centrale', 'Saint-Valérien', 'G0L 4E0'),
    },
    point: [-73.7301, 45.2201],
    color: BLUE,
    descriptionOnly: true,
  },
  // A true duplicate: the client's file lists the same row twice (Alex's own columns differ; the pins were pulled apart).
  {
    name: 'P1-242',
    fields: {
      PRENOM: 'Marc',
      NOM: 'Lesauce',
      ...addr('379, rue Saint-Jacques Nord', 'Causapscal', 'G0J 1J0'),
      TEL_RES: '450 555-0111',
    },
    point: [-72.7601, 45.2001],
    color: BLUE,
  },
  {
    name: 'P1-242',
    fields: {
      PRENOM: 'Marc',
      NOM: 'Lesauce',
      ...addr('379, rue Saint-Jacques Nord', 'Causapscal', 'G0J 1J0'),
      TEL_RES: '450 555-0111',
      'Package status': 'Given',
    },
    point: near([-72.7601, 45.2001], 15, 0),
    color: GREEN,
  },
  // Not a duplicate: one owner, one parcel ID, two cadastre lots (common in Alex's files).
  {
    name: 'P1-243',
    fields: {
      PRENOM: 'Hélène',
      NOM: 'Patatin',
      ...addr('88, route Centrale', 'Saint-Valérien', 'G0L 4E0'),
      NUM_LOT: '1 234 543',
    },
    point: [-73.7101, 45.2101],
    color: BLUE,
  },
  {
    name: 'P1-243',
    fields: {
      PRENOM: 'Hélène',
      NOM: 'Patatin',
      ...addr('88, route Centrale', 'Saint-Valérien', 'G0L 4E0'),
      NUM_LOT: '1 234 544',
    },
    point: near([-73.7101, 45.2101], 25, 0),
    color: BLUE,
  },
];

export const SECOND_LAYER: CaseRow[] = [
  {
    name: 'PT9-020',
    fields: {
      APPEL: 'Monsieur',
      PRENOM: 'Bernard',
      NOM: 'Tartiflette',
      ...addr('134, rue Saint-André', 'Saint-Pierre-Baptiste', 'G0P 1K0'),
    },
    point: [-73.4801, 45.3301],
    color: YELLOW,
  },
  {
    name: 'PT9-021',
    fields: {
      APPEL: 'Monsieur',
      PRENOM: 'Bernard',
      NOM: 'Tartiflette',
      ADRESSE: '134 rue St-André',
      MUNICIPALITE: 'Saint-Pierre-Baptistte',
      PROVINCE: '',
      CODE_POSTAL: '',
    },
    color: YELLOW,
  },
];

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kmlColor(hex: string): string {
  const rgb = hex.replace('#', '');
  return `ff${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toLowerCase();
}

function placemark(row: CaseRow): string {
  const fields = COLUMNS.map((column) => [column, row.fields[column] ?? ''] as const);
  const address = [
    row.fields.ADRESSE,
    row.fields.MUNICIPALITE,
    row.fields.PROVINCE,
    row.fields.CODE_POSTAL,
  ]
    .filter(Boolean)
    .join(' ');
  const description = fields.map(([column, value]) => `${column}: ${value}`).join('<br>');
  const geometry = row.point
    ? `<Point><coordinates>${row.point[0].toFixed(7)},${row.point[1].toFixed(7)},0</coordinates></Point>`
    : `<address>${xmlEscape(address)}</address>`;
  const extended = row.descriptionOnly
    ? ''
    : `<ExtendedData>${fields.map(([column, value]) => `<Data name="${xmlEscape(column)}"><value>${xmlEscape(value)}</value></Data>`).join('')}</ExtendedData>`;
  return `<Placemark><name>${xmlEscape(row.name)}</name>${geometry}<description><![CDATA[${description}]]></description><styleUrl>#icon-1899-${row.color.slice(1)}</styleUrl>${extended}</Placemark>`;
}

export function buildKml(layers: Record<string, CaseRow[]>, withReference = true): string {
  const colors = new Set(Object.values(layers).flatMap((rows) => rows.map((row) => row.color)));
  const styles = [...colors]
    .map((hex) => {
      const id = `icon-1899-${hex.slice(1)}`;
      return (
        `<Style id="${id}-normal"><IconStyle><color>${kmlColor(hex)}</color><scale>1</scale></IconStyle></Style>` +
        `<Style id="${id}-highlight"><IconStyle><color>${kmlColor(hex)}</color><scale>1</scale></IconStyle></Style>` +
        `<StyleMap id="${id}"><Pair><key>normal</key><styleUrl>#${id}-normal</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#${id}-highlight</styleUrl></Pair></StyleMap>`
      );
    })
    .join('');
  const folders = Object.entries(layers)
    .map(
      ([name, rows]) =>
        `<Folder><name>${xmlEscape(name)}</name>${rows.map(placemark).join('')}</Folder>`,
    )
    .join('');
  const reference = withReference
    ? `<Folder><name>Directions from P1-216B to P1-216B</name>` +
      `<Placemark><name>P1-216B</name><styleUrl>#icon-ci-22-nodesc</styleUrl><Point><coordinates>-73.6105,45.2641,0</coordinates></Point></Placemark>` +
      `<Placemark><name>Directions</name><LineString><coordinates>-73.6105,45.2641,0 -73.5901,45.2701,0</coordinates></LineString></Placemark>` +
      `<Placemark><name>P1-220</name><styleUrl>#icon-ci-23-nodesc</styleUrl><Point><coordinates>-73.5701,45.2402,0</coordinates></Point></Placemark></Folder>`
    : '';
  const polygon = withReference
    ? `<Placemark><name>Work area</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-73.62,45.26,0 -73.60,45.26,0 -73.60,45.27,0 -73.62,45.26,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Terrain cases</name><description/>${styles}${folders.replace('</Folder>', `${polygon}</Folder>`)}${reference}</Document></kml>`;
}

function kmz(kml: string): Uint8Array {
  return zipSync({
    'doc.kml': strToU8(kml),
    'images/icon-1.png': new Uint8Array([137, 80, 78, 71]),
  });
}

/** Deterministic pseudo-random numbers, so the 2,000-row file is the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Alain',
  'Marie',
  'Luc',
  'Sylvie',
  'René',
  'Anne',
  'Guy',
  'Manon',
  'Yvon',
  'Lise',
  'Denis',
  'Céline',
  'Marc',
  'Julie',
  'Éric',
  'Nathalie',
];
const LAST = [
  'Trempette',
  'Grains',
  'Rôti',
  'Croquette',
  'Bouchée',
  'Gratin',
  'Moutarde',
  'Lardon',
  'Fondue',
  'Galette',
  'Oignon',
  'Pelure',
  'Beignet',
  'Légume',
];
const STREETS = [
  'rue Saint-Paul',
  'chemin du Lac',
  'rue Sainte-Anne',
  'avenue Principale',
  'rue Principale',
  'route Centrale',
  'montée de Cazaville',
  'rue Fleury Ouest',
];
const TOWNS: [string, string][] = [
  ['Saint-Roch-des-Aulnaies', 'G0R 4E0'],
  ['Saint-Louis-de-Blandford', 'G0Z 1B0'],
  ['Amqui', 'G5J 2G2'],
  ['Saint-Anicet', 'J0S 1B0'],
  ['Val-Brillant', 'G0J 3L0'],
];
const PALETTE = [BLUE, BLUE, BLUE, BLUE, GREEN, GREEN_2, YELLOW, YELLOW_2, BLACK, RED];

/** A campaign of any size, built like a real one: a third of the pins placed, couples, owners with two parcels. */
export function buildBigLayers(count = 2000): Record<string, CaseRow[]> {
  const next = random(20260930);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const layers: Record<string, CaseRow[]> = {};
  let parcel = 1;
  let rows = 0;
  let house = 0;
  while (rows < count) {
    const layer = `Zone ${String(1 + Math.floor(house / 200))}`;
    const [town, postal] = pick(TOWNS);
    const street = `${String(10 + house)}, ${pick(STREETS)}`;
    const home: [number, number] = [-73.9 + next() * 1.2, 45.1 + next() * 0.9];
    const placed = next() < 0.34;
    const last = pick(LAST);
    const owners = next() < 0.35 ? 2 : 1;
    const parcels = next() < 0.25 ? 2 : 1;
    for (let p = 0; p < parcels && rows < count; p++) {
      const id = `B${String(1 + Math.floor(parcel / 500))}-${String(parcel).padStart(4, '0')}`;
      parcel += 1;
      for (let o = 0; o < owners && rows < count; o++) {
        const color = pick(PALETTE);
        const row: CaseRow = {
          name: id,
          fields: {
            APPEL: o === 0 ? 'Monsieur' : 'Madame',
            PRENOM: pick(FIRST),
            NOM: last,
            ...addr(street, town, postal),
            TEL_RES: `450 555-${String(1000 + house).slice(-4)}`,
            CELLULAIRE: `514 555-${String(2000 + rows).slice(-4)}`,
            NUM_LOT: String(2000000 + parcel).replace(/(\d)(\d{3})(\d{3})$/, '$1 $2 $3'),
            'Package status':
              color === GREEN || color === GREEN_2
                ? 'Given'
                : color === YELLOW || color === YELLOW_2
                  ? 'At door'
                  : '',
          },
          color,
        };
        if (placed) row.point = near(home, o * 20 + p * 15, p * 10);
        (layers[layer] ??= []).push(row);
        rows += 1;
      }
    }
    house += 1;
  }
  return layers;
}

function xlsxFile(rows: unknown[][]): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Parcels');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** For the accented letters of French, Windows-1252 bytes equal the Latin-1 code points. */
function windows1252(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 255) throw new Error(`Not in Windows-1252: ${text.charAt(i)}`);
    bytes[i] = code;
  }
  return bytes;
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const layers = { 'Cases layer': CASES, 'Second layer': SECOND_LAYER };
  writeFileSync(join(OUT, 'cases.kmz'), kmz(buildKml(layers)));

  const renamed = CASES.map((row) =>
    row.name === 'P1-240'
      ? { ...row, fields: { ...row.fields, NOM: 'Trempette', CELLULAIRE: '450 555-0150' } }
      : row,
  );
  writeFileSync(
    join(OUT, 'cases-renamed.kmz'),
    kmz(buildKml({ 'Cases layer': renamed, 'Second layer': SECOND_LAYER })),
  );

  writeFileSync(join(OUT, 'big-2000.kmz'), kmz(buildKml(buildBigLayers(), false)));

  const header = [
    'Parcel ID',
    'PRENOM',
    'NOM',
    'ADRESSE',
    'MUNICIPALITE',
    'CODE_POSTAL',
    'Package status',
    'Latitude',
    'Longitude',
  ];
  const placed = CASES.filter((row) => row.point).slice(0, 6);
  writeFileSync(
    join(OUT, 'cases.xlsx'),
    xlsxFile([
      header,
      ...placed.map((row) => [
        row.name,
        row.fields.PRENOM ?? '',
        row.fields.NOM ?? '',
        row.fields.ADRESSE ?? '',
        row.fields.MUNICIPALITE ?? '',
        row.fields.CODE_POSTAL ?? '',
        row.fields['Package status'] ?? '',
        row.point?.[1],
        row.point?.[0],
      ]),
    ]),
  );
  writeFileSync(
    join(OUT, 'no-coordinates.xlsx'),
    xlsxFile([
      ['Parcel ID', 'NOM', 'ADRESSE'],
      ['P1-095B', 'Sauceau', '60, rue Sainte-Anne'],
    ]),
  );
  writeFileSync(
    join(OUT, 'cases-1252.csv'),
    windows1252(
      'Parcel ID,PRENOM,NOM,MUNICIPALITE,Latitude,Longitude\r\nP1-240,Jean,Trempoté,Saint-Élie-de-Caxton,45.2601,-73.8801\r\nP1-241,Luce,Moutarde,Saint-Valérien,45.2201,-73.7301\r\n',
    ),
  );
  console.log(`Fixtures written to ${OUT}`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();

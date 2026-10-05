/**
 * Fetches non-chain restaurants around Québec from OpenStreetMap (Overpass API) for Terrain's sample
 * data (Alex's idea, 2026-09-30): cantines, casse-croûtes and poutine shacks first.
 * Writes fixtures/public/restaurants.json. Data © OpenStreetMap contributors, ODbL.
 *
 * Run: npm run restaurants
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fold } from '../src/domain/text.ts';

const OUT = join(import.meta.dirname, '..', 'fixtures', 'public', 'restaurants.json');

const QUERY = `[out:json][timeout:180];
area["ISO3166-2"="CA-QC"]["admin_level"="4"]->.qc;
nwr["amenity"~"^(fast_food|restaurant)$"]["name"]["addr:housenumber"]["addr:street"]["addr:city"](area.qc);
out center tags;`;

// Chains that may lack a brand tag in OpenStreetMap. Any name seen 3 times or more is dropped too.
const CHAINS =
  /mc ?donald|tim horton|subway|a ?& ?w\b|burger king|dairy queen|\bkfc\b|kentucky|pizza hut|domino|st-hubert|saint-hubert|benny|valentine|lafleur|belle province|ashton|\bcora\b|normandin|frite alors|\bmikes?\b|scores|tha[iï] express|sushi shop|pizza pizza|little caesars|harvey|wendy|five guys|casa grecque|commensal|chocolats favoris|b[aâ]ton rouge|la cage|boston pizza|dixie lee|mary brown|popeyes|starbucks|second cup|van houtte|caf[eé] d[eé]p[oô]t|presse caf[eé]|pacini|eggsquis|madison|east side mario|copper branch|ben ?& ?florentine|allo mon coco|allô mon coco|tutti frutti/i;

const CANTINE = /cantine|casse[- ]?cro[uû]te|patate|poutine|frite|snack|bar laitier|chez /i;

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface Restaurant {
  osm: string;
  name: string;
  housenumber: string;
  street: string;
  city: string;
  postcode: string;
  lat: number;
  lon: number;
  cantine: boolean;
}

function metersBetween(a: Restaurant, b: Restaurant): number {
  const north = (b.lat - a.lat) * 111_320;
  const east = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(north, east);
}

async function main(): Promise<void> {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'Terrain test fixtures (https://github.com/BlueReceipt/Terrain)' },
    body: new URLSearchParams({ data: QUERY }),
  });
  if (!response.ok) throw new Error(`Overpass answered ${String(response.status)}`);
  const { elements } = (await response.json()) as { elements: OsmElement[] };

  const named = elements.filter((e) => e.tags?.name && !e.tags.brand && !e.tags['brand:wikidata']);
  const seen = new Map<string, number>();
  for (const e of named) {
    const key = fold(e.tags?.name ?? '');
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const candidates: Restaurant[] = [];
  for (const e of named) {
    const tags = e.tags ?? {};
    const name = (tags.name ?? '').trim();
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (
      lat === undefined ||
      lon === undefined ||
      CHAINS.test(name) ||
      (seen.get(fold(name)) ?? 0) >= 3
    )
      continue;
    candidates.push({
      osm: `${e.type}/${String(e.id)}`,
      name,
      housenumber: (tags['addr:housenumber'] ?? '').trim(),
      street: (tags['addr:street'] ?? '').trim(),
      city: (tags['addr:city'] ?? '').trim(),
      postcode: (tags['addr:postcode'] ?? '').trim().toUpperCase(),
      lat,
      lon,
      cantine:
        CANTINE.test(name) || /poutine|burger|chicken|fish_and_chips/i.test(tags.cuisine ?? ''),
    });
  }

  // One restaurant per address, none within 15 m of another: each must stand for a different house.
  candidates.sort((a, b) => Number(b.cantine) - Number(a.cantine) || a.osm.localeCompare(b.osm));
  const places: Restaurant[] = [];
  const addresses = new Set<string>();
  for (const place of candidates) {
    const address = fold(`${place.housenumber} ${place.street} ${place.city}`);
    if (addresses.has(address) || places.some((other) => metersBetween(place, other) < 15))
      continue;
    addresses.add(address);
    places.push(place);
  }

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        source:
          'OpenStreetMap, amenity=fast_food|restaurant in Québec with a full street address, chains removed',
        attribution: '© OpenStreetMap contributors, ODbL 1.0',
        places,
      },
      null,
      1,
    )}\n`,
  );
  console.log(
    `${String(elements.length)} found, ${String(places.length)} kept (${String(places.filter((p) => p.cantine).length)} cantines and casse-croûtes, ${String(places.filter((p) => p.postcode).length)} with a postal code) → ${OUT}`,
  );
}

await main();

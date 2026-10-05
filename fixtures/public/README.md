# fixtures/public

Sample files for the tests, all made of poutine places and their address. 

- `poutine-autour-du-quebec.kmz`: a real Google My Maps export, made by Alex from the three spreadsheets in `poutine-map/` (built from `restaurants.json`, then trimmed by hand): 114 casse-croûtes, cantines and poutine shops across Québec in 124 rows and 3 layers, every pin placed by its Latitude and Longitude. Each layer keeps a different set of columns, as real files do. The spreadsheets are a starting template: add your own columns for your campaigns.
- `cases.kmz`, `cases-renamed.kmz`, `big-2000.kmz`, `cases.xlsx`, `cases-1252.csv`, `no-coordinates.xlsx`: synthetic, written by `scripts/make-fixtures.ts` (`npm run fixtures`). `cases.kmz` holds every house and lot case Terrain must handle and the quirks seen in real My Maps exports. Their owners (the Trempette, Grains and Poutini families, among others) are invented, in towns that have a poutine place.
- `restaurants.json`: the poutine places above, from OpenStreetMap (`npm run restaurants`).
- `test-basemap.pmtiles`: a small invented offline map for the map tests (`npm run test-basemap`).

Restaurant names, addresses and positions: © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0), https://www.openstreetmap.org/copyright. Nothing in these files says anything true about those restaurants: their parcels, owners, visits and notes are fiction, and every phone number is in the 555-01xx range kept for fiction.

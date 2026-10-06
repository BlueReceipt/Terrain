# Terrain: the land agent friend

A field book for land-contact campaigns, on the phone and offline. The client's Excel comes straight in (Terrain finds each house from its address), or your My Maps pins from a KMZ; Terrain shows one pin per house, every row of the house on one card, and writes what you do at the door (status, Visit date, corrections, calls, notes) into the client's own columns. Names, phone numbers and notes stay on the phone until you export them.

**Try it:** https://terrain.ederer.digital. Its first screen offers a sample, 124 poutine places across Québec, built into the app, and opens your own My Maps map by its link if the map is shared with *Anyone with the link*. While it's online, the map draws the streets under the pins from [OpenFreeMap](https://openfreemap.org). What you do there stays in your browser. (The sample and the links are offered only on the addresses listed in `src/ui/demo.ts`; see "The relay" below.)

## 1. Put Terrain online (once, on the PC)

Terrain is a set of files with no server and no account behind it. Cloudflare hosts them for free at an `https://` address, which the phone needs to install the app.

1. In the Terrain folder, run `npm run build`. It makes the `dist` folder (about 40 files, 3 MB).
2. Make a free Cloudflare account at dash.cloudflare.com, if you don't have one.
3. In the dashboard: **Compute → Workers & Pages** → **Create application**, then the option to upload your own files.
4. Name it, drag in the `dist` folder (the file list must show `index.html` at the top, not inside a `dist` folder), and deploy. Cloudflare gives it a free address ending in `.workers.dev`.
5. Open that address in Chrome on the PC: Terrain's first screen says *Import the client’s Excel, or a KMZ export from My Maps, to start a campaign.*
6. Its own address, on a domain in the same Cloudflare account: in the Worker, **Domains** → **Add Domain** (a custom domain, not a route), for example `landagentfriend.ederer.digital`. Install the app on the phone from one address only: the phone keeps Terrain's data per address.
7. On a free account, Cloudflare adds its Web Analytics script to your domain's pages. Terrain's security policy blocks it, but turn it off at the source: search the dashboard for **Web Analytics** → **Manage site** → **Disable**.

The site is public, but it only holds the app: no campaign, name or phone number ever goes to Cloudflare. Your data stays on the phone.

To update Terrain without uploading anything, connect the Worker to your copy of this repository once: in the Worker, **Settings → Builds → Connect**, then the repository and its `main` branch, with `npm run build` as the build command and `npx wrangler deploy` as the deploy command. From then on, each push to `main` builds Terrain and publishes it as `wrangler.jsonc` says: set its `name` to your Worker's and its addresses to yours first, since Wrangler replaces the Worker's addresses with the ones listed there. Without that: run `npm run build` again, then in the Worker choose **New deployment** and upload the new `dist` the same way. On the phone, Terrain shows **Update ready** with **Reload** once nothing is open (no card sheet, no export, no call waiting).

### The relay

Terrain only ever talks to its own address. A second, small Worker on routes of that address fetches for it, `relay/worker.js`, and logs or keeps nothing:

- `/geocode`: where houses are, for files without coordinates: in Québec from [Adresses Québec](https://www.donneesquebec.ca/recherche/dataset/adresses-quebec) (Gouvernement du Québec, CC BY 4.0), elsewhere in Canada from Natural Resources Canada's [Geolocation Service](https://geogratis.gc.ca/) (Open Government Licence – Canada), which estimates a civic number's place along its street. It takes each house's street, town, postal code and province, and refuses anything else.
- `/tiles/…`: the background map's tiles from OpenFreeMap (OpenStreetMap data, free, no key). Offline, the map stays plain under the pins.
- `/mymaps/…`, on the public demo only: Google doesn't let other sites read a My Maps export, so the relay fetches one map's KMZ export, only for a map shared with *Anyone with the link*.

The addresses with a relay are listed in `src/ui/online.ts`, and **Settings → Online** turns each lookup off. On any other address Terrain never goes online: houses without coordinates wait in a list for **Use my location**, and the background map is an offline map file (section 4). To set the relay up for your own addresses:

1. **Compute → Workers & Pages → Create application → Start with Hello World**. Name it (Alex's is `terrain-mymaps`) and deploy.
2. In `relay/wrangler.jsonc`, set the name to your Worker's and the routes to your addresses and their domain.
3. In that Worker: **Settings → Builds → Connect**, then the repository and its `main` branch, with `relay` as the root directory, no build command, and `npx wrangler deploy` as the deploy command. Each push to `main` then publishes the relay with its routes. Without that: paste `relay/worker.js` into **Edit code** and deploy, then add each route in **Domains → Add Route**, failure mode *Fail closed*.
4. List your addresses in `src/ui/online.ts` (and the demo's in `DEMO_HOSTS` in `src/ui/demo.ts`), then publish the app again: a push, or a new `dist` uploaded to the app's Worker.

## 2. Install it on the phone

1. Open the address in Chrome or Brave on the Pixel.
2. In the browser menu, choose **Install app** (or **Add to Home screen**).
3. Open Terrain from the home screen. In **Settings → Storage**, if it says *Not kept yet*, tap **Keep Terrain's data**.

## 3. Start a campaign

From the client's Excel, with no My Maps at all:

1. In Terrain: **Import file**, choose the `.xlsx` (or `.csv`). It needs a street and a town column (ADRESSE and MUNICIPALITE), or Latitude and Longitude.
2. With a connection, Terrain finds each house without coordinates from its address: only its street, town, postal code and province go out, to Adresses Québec, or Natural Resources Canada elsewhere in Canada (those are placed on the street, estimated from the civic number). Addresses outside Canada wait in the list. The **Import report** counts the houses found at their address, those found on their street only (check them at the door with **Use my location**) and those not found, which wait in a list. Then **Open campaign**.

Or from My Maps:

1. In My Maps: layer menu (or the map menu) → **Export to KML/KMZ** → untick *Keep data up to date with network link KML* → KMZ.
2. In Terrain: **Import file**, choose the KMZ, check the **Pin colors**, read the **Import report**, then **Open campaign**. The pins My Maps exports without coordinates are found from their address too.

Importing a newer file into the same campaign later keeps your corrections, moved houses, found positions and statuses; the report lists anything the file disagrees with. Rows are one house only when their addresses are the same (street, number and postal code, or the town when there is no postal code); spelling, accents and case don't count.

## 4. The map without signal

On the addresses with a relay, the map draws its streets online (Settings → Online), and while there's a connection Terrain keeps the map around every house on the phone, so it shows with no signal: close up at each house, wider and coarser around. **Settings → Offline map** shows how much is kept: about 50 MB for a campaign of 900 houses, best fetched once on Wi-Fi.

A map file made on the PC covers a whole area in more detail, and comes first when loaded:

1. In Terrain: **Settings → Offline map → Copy campaign area**.
2. On the PC, in the Terrain folder: `npm run basemap -- ` followed by the area. It downloads that area's map data (tens of megabytes) and writes the file into `basemaps/`.
3. Copy the file to the phone, then **Settings → Offline map → Load a map file**.

Without either, the pins still show on a plain background.

## 5. At a house

- Tap the pin: the card lists every row at the house, by parcel ID. **Show everything** opens the full card.
- The rail marks the whole house in one tap: **Given**, **At door**, **To research**, **Skipped**. The toast's **Undo** takes it back for 6 seconds.
  - **Given** closes the lot: co-owners of the same parcels at other addresses become Given too, with a note saying with whom and where.
  - **To research** asks for a note and leaves "Co-owner to research" on the co-owners elsewhere.
- One row only: tap the owner, then use the small rail **This row only**.
- **Edit info** (full card) corrects names, phones and addresses, each owner's once. **Use my location** pins the house where you stand.
- **Call** opens the dialer; back in Terrain, *How did the call go?* asks for the outcome. **Log call** records a call made outside Terrain.
- **Note** writes a note for every row at the house. Press and hold a note to delete it.
- **Navigate** opens Google Maps directions to the house.

## 6. End of the day

- **Day log** (bottom left of the map): the day's work, house by house. **Copy as text** or **Share**.
- **Export** (from the day log):
  - **Export Excel**: Parcels (every row with its current values, in the client's columns) and Journal (every change, with what it replaced).
  - **My Maps update**: one file per layer. In My Maps, on a copy of the map: layer menu → **Reimport and merge** → **Replace all items** → the layer's file → position by **Location** → title **Parcel ID**, then style by *Package status*.
  - **Back up**: everything on the phone, every campaign.
- The phone's share sheet sends the file where Chrome allows that file type; otherwise it goes to Downloads.

## 7. A new phone

On the old phone, **Back up**. On the new one, install Terrain, then **Restore from backup** and choose the file. The offline map is not in the backup: load it again.

## Privacy

Landowner names, phones and addresses are personal information (Quebec's Law 25). Terrain keeps them on the phone: no server, no account, no analytics, and it never contacts any other site. On the addresses with a relay, two things go out through it, each with a switch in **Settings → Online**: a house's street, town, postal code and province, to find a house without coordinates (Adresses Québec, or Natural Resources Canada elsewhere in Canada), and map areas, for the streets on screen and the map kept around the houses (OpenFreeMap). Names, phone numbers, parcel IDs, notes and statuses never leave the phone; an end-to-end test imports a file full of them and fails if any shows up in a request. Otherwise data leaves the phone only when you export it, and where those files go is up to you.

## For development

`npm run check` runs everything (format, lint, types, unit tests, build, end-to-end tests).

The sample files are in `fixtures/public/`, all made of poutine places: `poutine-autour-du-quebec.kmz` is a real My Maps export, made from the spreadsheets in `fixtures/public/poutine-map/`, a starting template you can add your own columns to; the other files are synthetic (`npm run fixtures`). Your own files go in `fixtures/private/`, which git ignores.

## License

MIT, see `LICENSE`. Restaurant names, addresses and positions come from OpenStreetMap (ODbL, credit in `fixtures/public/README.md`).

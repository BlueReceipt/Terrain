# Terrain: the land agent friend

A field book for land-contact campaigns, on the phone and offline. Your My Maps pins come in from a KMZ; Terrain shows one pin per house, every row of the house on one card, and writes what you do at the door (status, Visit date, corrections, calls, notes) into the client's own columns. Everything stays on the phone until you export it.

**Try it:** https://terrain.ederer.digital. Its first screen offers a sample, 124 poutine places across Québec, built into the app. What you do there stays in your browser. (The sample is offered only on the addresses listed in `src/ui/sample.ts`.)

## 1. Put Terrain online (once, on the PC)

Terrain is a set of files with no server and no account behind it. Cloudflare hosts them for free at an `https://` address, which the phone needs to install the app.

1. In the Terrain folder, run `npm run build`. It makes the `dist` folder (about 40 files, 3 MB).
2. Make a free Cloudflare account at dash.cloudflare.com, if you don't have one.
3. In the dashboard: **Compute → Workers & Pages** → **Create application**, then the option to upload your own files.
4. Name it, drag in the `dist` folder (the file list must show `index.html` at the top, not inside a `dist` folder), and deploy. Cloudflare gives it a free address ending in `.workers.dev`.
5. Open that address in Chrome on the PC: Terrain's first screen says *Import a KMZ export from My Maps to start a campaign.*
6. Its own address, on a domain in the same Cloudflare account: in the Worker, **Domains** → **Add Domain** (a custom domain, not a route), for example `landagentfriend.ederer.digital`. Install the app on the phone from one address only: the phone keeps Terrain's data per address.
7. On a free account, Cloudflare adds its Web Analytics script to your domain's pages. Terrain's security policy blocks it, but turn it off at the source: search the dashboard for **Web Analytics** → **Manage site** → **Disable**.

The site is public, but it only holds the app: no campaign, name or phone number ever goes to Cloudflare. Your data stays on the phone.

To update Terrain later: run `npm run build` again, then in the Worker choose **New deployment** and upload the new `dist` the same way. On the phone, Terrain shows **Update ready** with **Reload** once nothing is open (no card sheet, no export, no call waiting).

## 2. Install it on the phone

1. Open the address in Chrome or Brave on the Pixel.
2. In the browser menu, choose **Install app** (or **Add to Home screen**).
3. Open Terrain from the home screen. In **Settings → Storage**, if it says *Not kept yet*, tap **Keep Terrain's data**.

## 3. Start a campaign

1. In My Maps: layer menu (or the map menu) → **Export to KML/KMZ** → untick *Keep data up to date with network link KML* → KMZ.
2. In Terrain: **Import file**, choose the KMZ, check the **Pin colors**, read the **Import report**, then **Open campaign**.
3. Importing a newer KMZ into the same campaign later keeps your corrections, moved houses and statuses; the report lists anything the file disagrees with.

## 4. Load an offline map

1. In Terrain: **Settings → Offline map → Copy campaign area**.
2. On the PC, in the Terrain folder: `npm run basemap -- ` followed by the area. It downloads that area's map data (tens of megabytes) and writes the file into `basemaps/`.
3. Copy the file to the phone, then **Settings → Offline map → Load a map file**.

Without a map, the pins still show on a plain background.

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

Landowner names, phones and addresses are personal information (Quebec's Law 25). Terrain keeps them on the phone only: no server, no account, no analytics, and it never contacts any other site. Data leaves the phone only when you export it, and where those files go is up to you.

## For development

`npm run check` runs everything (format, lint, types, unit tests, build, end-to-end tests).

The sample files are in `fixtures/public/`, all made of poutine places: `poutine-autour-du-quebec.kmz` is a real My Maps export, made from the spreadsheets in `fixtures/public/poutine-map/`, a starting template you can add your own columns to; the other files are synthetic (`npm run fixtures`). Your own files go in `fixtures/private/`, which git ignores.

## License

MIT, see `LICENSE`. Restaurant names, addresses and positions come from OpenStreetMap (ODbL, credit in `fixtures/public/README.md`).

import { signal } from '@preact/signals';
import type { RestoreErrorCode } from '../data/backup.ts';
import type { BasemapErrorCode } from '../data/basemap.ts';
import type { ImportErrorCode } from '../domain/errors.ts';
import type { DayLogWords } from '../domain/daylog.ts';
import type { JournalWords } from '../domain/export/journal.ts';
import type { PreviousInfoWords } from '../domain/newOwner.ts';
import type { NoteWords } from '../domain/notes.ts';
import type { AppRole, FieldRole } from '../domain/types.ts';

const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-CA')} ${n === 1 ? one : many}`;

/** "4.0 MB", "10.0 GB": in a language's digits and units. */
function sizeIn(bytes: number, locale: string, mb: string, gb: string): string {
  const megabytes = bytes / 1_048_576;
  const digits = (value: number, decimals: number) =>
    value.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  return megabytes >= 1024
    ? `${digits(megabytes / 1024, 1)} ${gb}`
    : `${digits(megabytes, megabytes < 10 ? 1 : 0)} ${mb}`;
}

// Every user-facing string lives here, in English and in French (Alex, 2026-10-06).
const english = {
  appName: 'Terrain',
  rows: (n: number) => count(n, 'entry', 'entries'),
  houses: (n: number) => count(n, 'house', 'houses'),
  pins: (n: number) => count(n, 'pin', 'pins'),
  noName: 'No name',
  noAddress: 'No address',
  cancel: 'Cancel',
  continue: 'Continue',
  home: {
    noCampaign: 'Import the client’s Excel, or a KMZ export from My Maps, to start a campaign.',
    importFile: 'Import file',
    sampleSentence:
      'Try Terrain with 124 poutine places across Québec, or import a KMZ export from My Maps.',
    trySample: 'Try the poutine sample',
    openLink: 'Open a My Maps link',
    linkLabel: 'My Maps link',
    linkHint:
      'Paste the map’s link, or its “Embed on my site” code. The map must be shared: Anyone with the link can view.',
    linkOpen: 'Open the map',
    linkInvalid: 'This isn’t a My Maps link. In My Maps, choose Share, then copy the map’s link.',
    linkReading: 'your My Maps map',
  },
  reading: (fileName: string) => `Reading ${fileName}…`,
  placing: {
    finding: (n: number) => `Finding ${count(n, 'house', 'houses')} from their address…`,
    progress: (done: number, total: number) =>
      `${done.toLocaleString('en-CA')} of ${total.toLocaleString('en-CA')}`,
    what: 'Only each house’s street, town, postal code and province go out: to Adresses Québec, or Natural Resources Canada elsewhere in Canada. Names, phone numbers, parcel IDs and notes stay on the phone.',
    stop: 'Stop looking up',
  },
  failed: {
    title: 'This file can’t be imported',
    chooseAnother: 'Choose another file',
    storage:
      'Terrain can’t save on this device. Close private browsing, or install Terrain to the home screen, then try again.',
    unexpected:
      'Something went wrong while reading this file. Nothing was changed. Try again, or export the file from My Maps again.',
    reasons: {
      'unsupported-file':
        'Terrain reads KMZ and KML files from My Maps, and Excel or CSV files with coordinates.',
      'damaged-kmz': 'This KMZ file is damaged or isn’t a KMZ. Export it from My Maps again.',
      'no-kml-in-kmz': 'This KMZ has no map inside. Export it from My Maps again.',
      'network-link-only':
        'This file only links to your map online; it holds no pins. In My Maps, export again with “Keep data up to date with network link KML” unticked.',
      'not-kml': 'This file can’t be read as a map. Export it from My Maps again.',
      'no-rows':
        'This file has no pins or entries. Check that you exported the right map or layer from My Maps.',
      'no-coordinates':
        'This file has no coordinates, and no street and town to find its houses from. Add Latitude and Longitude columns, or address and town columns (ADRESSE and MUNICIPALITE), then import it again.',
      'unreadable-spreadsheet':
        'This spreadsheet can’t be read. Save it again as .xlsx or .csv and import that.',
    } satisfies Record<ImportErrorCode, string>,
    myMapsTitle: 'This map can’t be opened',
    anotherLink: 'Try another link',
    myMaps: {
      'not-shared':
        'This map isn’t shared. In My Maps, choose Share and set the link to “Anyone with the link can view”, then try again. Or export the map as a KMZ file and import that.',
      'not-found':
        'Google has no map at this link. Check the link, or export the map as a KMZ file and import that.',
      offline:
        'Opening a My Maps link needs a connection. Try again with signal, or import a KMZ file.',
      unexpected:
        'Google didn’t send the map. Try again in a moment, or export the map as a KMZ file and import that.',
    },
  },
  mapping: {
    title: 'Match the columns',
    intro: (fileName: string) =>
      `Terrain didn’t find these columns in ${fileName}. Pick the column that holds each one.`,
    notInFile: 'Not in this file',
    roles: {
      parcelId: 'Parcel ID',
      packageStatus: 'Package status',
      visitDate: 'Visit date',
      callDate: 'Call date',
      callResult: 'call result',
      notes: 'Notes',
    } as Partial<Record<FieldRole, string>>,
  },
  colors: {
    title: 'Pin colors',
    intro: 'Each pin color becomes a status. Check that each color means what Terrain guessed.',
    noGuess: 'No match: check this one',
    seenAs: (texts: readonly string[]) => `Package status on these pins: ${texts.join(', ')}`,
    statusFor: (color: string) => `Status for ${color}`,
  },
  report: {
    title: 'Import report',
    inFile: (rows: number, fileName: string) => `${count(rows, 'entry', 'entries')} in ${fileName}`,
    added: 'Added',
    updated: 'Updated',
    unchanged: 'Unchanged',
    houses: 'Houses',
    ownerDetailsChanged: 'Owner details changed',
    newOwners: 'New owners',
    newOwnersHelp:
      'Someone else is named: they start over at the file’s status, and the owner before goes to Previous info.',
    newOwner: (previous: string, next: string) => `${previous} → ${next}`,
    conflicts: 'Your corrections the file disagrees with',
    conflict: (column: string, local: string, incoming: string) =>
      `${column}: yours “${local}”, file “${incoming || '(blank)'}”`,
    duplicates: 'Entries listed twice (same parcel ID, owner and address)',
    duplicatesHelp: 'Terrain keeps both entries. Check them in the client’s file.',
    missing: 'Entries missing from this file',
    missingHelp: 'They stay in the campaign, flagged, after the other entries.',
    severalRows: 'Houses with more than one entry',
    noPosition: 'Houses with no position yet',
    noPositionHelp:
      'No coordinates in the file, and no address Terrain could find. They wait in a list until you pin each house at the door.',
    placedAtAddress: 'Houses found at their address',
    placedOnStreet: 'Houses found on their street only',
    placedOnStreetHelp:
      'The address service knows the street, not the house (outside Québec, it estimates the place from the civic number). Check each at the door: Use my location puts it right.',
    placedFrom:
      'Positions from addresses: Adresses Québec (Gouvernement du Québec, CC BY 4.0) and Natural Resources Canada’s Geolocation Service (Open Government Licence – Canada).',
    lookUpFailed:
      'The address service couldn’t be reached. The houses it didn’t find wait with no position: import the file again with a connection to look them up.',
    lookUpStopped:
      'Lookups stopped. The houses not looked up wait with no position: import the file again to look them up.',
    lots: 'Parcels at more than one house',
    severalIds: 'Cells listing several parcel IDs',
    severalIdsHelp:
      'Mark an ID as old when it’s crossed out in the client’s file. An entry never joins a lot through an old ID.',
    markOld: (id: string) => `${id} is old`,
    sharedPoints: 'Different houses on one spot',
    sharedPointsHelp:
      'Usually a geocoding fallback such as a village center: these pins are probably in the wrong place.',
    spread: 'Houses whose entries are more than 50 m apart',
    spreadHelp:
      'Often pins pulled apart by hand. Terrain shows each house once, where most of its entries are.',
    colors: 'Pin colors',
    reference: (n: number) =>
      `${count(n, 'line, shape or route', 'lines, shapes and routes')} shown as a background drawing`,
    groupBy: 'Group entries into lots by',
    parcelIdOption: (lotNumber: string | undefined) =>
      lotNumber ? `Parcel ID and ${lotNumber}` : 'Parcel ID',
    openCampaign: 'Open campaign',
    startNew: 'Start a new campaign',
    mostlyNew: 'Most parcel IDs in this file are new to this campaign.',
    saving: 'Saving…',
    saveFailed: 'The campaign couldn’t be saved. Nothing was changed. Try again.',
  },
  campaign: {
    summary: (rows: number, houses: number) =>
      `${count(rows, 'entry', 'entries')} at ${count(houses, 'house', 'houses')}`,
    noPosition: (n: number) => `${count(n, 'house', 'houses')} with no position yet`,
    lots: (n: number) => `${count(n, 'parcel', 'parcels')} at more than one house`,
    importFile: 'Import file',
  },
  map: {
    label: 'Map of the campaign',
    search: 'Search parcel, owner, lot or address',
    // Short enough to show whole in the search box.
    searchHint: 'Parcel, owner, lot, address',
    clearSearch: 'Clear the search',
    locate: 'Show where I am',
    youreAt: (address: string) => `You’re at ${address}`,
    menu: 'Settings',
    noBasemap: 'No offline map loaded. Add one in Settings.',
    filters: 'Show houses by status',
    allStatuses: 'All',
    chip: (label: string, rows: number) => `${label} ${rows.toLocaleString('en-CA')}`,
    notOnMap: (n: number) => `${count(n, 'house', 'houses')} not on the map`,
    notOnMapTitle: 'Houses with no position yet',
    notOnMapHelp:
      'No coordinates in the file, and no address Terrain could find. Open one at the door to pin it there.',
    onStreet: (n: number) => `${count(n, 'house', 'houses')} on the street only`,
    onStreetTitle: 'Houses found on their street only',
    onStreetHelp:
      'The address service knows the street, not the house. Open one at the door to pin it there.',
    chooserTitle: (n: number) => `${String(n)} houses on this spot`,
    chooserHelp:
      'Different addresses on one point, usually a village center. These pins are probably in the wrong place.',
    close: 'Close',
    noResults: 'Nothing matches. Try a parcel ID, an owner, a lot number or an address.',
    lotResult: (column: string, value: string, houses: number) =>
      `${column} ${value}: ${count(houses, 'house', 'houses')}`,
    lotTitle: (column: string, value: string) => `${column} ${value}`,
    rowMatch: (parcelId: string, name: string) => `${parcelId}  ${name}`,
    locationDenied:
      'Terrain can’t see where you are. Allow location for this site in the browser’s settings.',
    locationWaiting: 'Waiting for the GPS…',
  },
  card: {
    rows: (n: number) => count(n, 'entry', 'entries'),
    close: 'Close',
    more: 'Show everything',
    less: 'Show less',
    alsoAt: (parcelId: string, address: string, owners: string) =>
      `${parcelId} also at ${address}: ${owners}`,
    ownerStatus: (name: string, status: string) => `${name}, ${status.toLowerCase()}`,
    previousInfo: 'Previous info',
    notInLatestFile: 'Not in the client’s latest file',
    noAddress: 'No address',
    noName: 'No name',
    noPosition: 'Not on the map yet',
    onStreet:
      'Found on the street only, from the address: check at the door, then Use my location.',
    statusLine: (status: string, when: string) => (when ? `${status}, ${when}` : status),
    rail: 'Mark the house',
    rowRail: 'This entry only',
    via: (address: string) => `via ${address}`,
    call: 'Call',
    logCall: 'Log call',
    note: 'Note',
    navigate: 'Navigate',
    noNumber: 'No phone number on file at this house. Log the call for the whole house below.',
    pinHere: (accuracy: string | null) =>
      accuracy ? `Use my location, accurate to ${accuracy} m` : 'Use my location for this house',
    pinHelp: 'Stand at the door: the house moves to where the phone is.',
    waitingForGps: 'Waiting for the GPS…',
    noteForRow: 'Note for this entry',
    editRow: 'Edit this entry',
    markRowToVisit: 'Mark as to visit',
    markHouseToVisit: 'Mark house as to visit',
    editInfo: 'Edit info',
    noValue: 'No value',
    edited: 'edited',
    imported: (value: string) => `Imported: ${value || '(blank)'}`,
    fields: 'Information',
    lotSection: 'Same parcel at other addresses',
    distance: (meters: number) =>
      meters < 1000 ? `${String(Math.round(meters))} m` : `${(meters / 1000).toFixed(1)} km`,
    open: 'Open',
    showOnMap: 'Show on map',
    notes: 'Notes',
    noNotes: 'No notes yet.',
    allRows: (n: number) => `All ${String(n)} entries`,
    lotMark: 'Lot',
    importedMark: 'From the file',
    deleteHint: 'Press and hold a note to delete it.',
    pendingCall: (number: string) => `Log call outcome: ${number}`,
  },
  calls: {
    choose: 'Which number?',
    chooseToLog: 'Which number did you call?',
    home: 'Home',
    numberLabel: (kind: string, owners: readonly string[]) =>
      kind === 'home'
        ? 'Home'
        : `${owners.join(' / ')}, ${kind === 'cell' ? 'cell' : kind === 'work' ? 'work' : kind}`,
    wholeHouse: 'Another number: the whole house',
    outcome: (number: string | null) =>
      number ? `How did the call to ${number} go?` : 'How did the call go?',
    discard: 'Forget this call',
  },
  noteEditor: {
    forHouse: (n: number, address: string) =>
      `Note for ${count(n, 'entry', 'entries')} at ${address}`,
    forRow: (name: string) => `Note for ${name}`,
    save: 'Save note',
    deleteTitle: 'Delete this note?',
    deleteBody: 'It leaves every entry it covers. The history keeps it.',
    delete: 'Delete note',
  },
  edit: {
    editShort: 'Edit',
    title: (address: string) => `Edit info: ${address}`,
    rowTitle: (name: string) => `Edit this entry: ${name}`,
    house: 'Same for the whole house',
    parcel: (parcelId: string) => `Parcel ${parcelId}`,
    differs: 'differs',
    save: 'Save changes',
    nothing: 'Nothing changed.',
    newOwner: 'New owner',
    newOwnerHelp: (previous: string, restart: string | null) =>
      [
        previous && `${previous} goes to Previous info when you save.`,
        restart && `That visit was theirs: the entry goes back to ${restart}.`,
        'Type the new owner’s name and numbers.',
      ]
        .filter(Boolean)
        .join(' '),
  },
  // What Previous info keeps of an owner, at the door or from the client's file, also in the export.
  previousInfo: {
    previousOwner: (details, until) => `${details} (until ${until})`,
    visit: (status, date) => (date ? `${status} ${date}` : status),
  } satisfies PreviousInfoWords,
  toast: {
    undo: 'Undo',
    rowMarked: (parcelId: string, status: string) => `${parcelId} marked ${status.toLowerCase()}`,
    houseMarked: (status: string, rows: number, address: string) =>
      `${status}: ${count(rows, 'entry', 'entries')} at ${address}`,
    alsoClosed: (rows: number, address: string | null, houses: number) =>
      address
        ? ` and ${count(rows, 'entry', 'entries')} at ${address}`
        : ` and ${count(rows, 'entry', 'entries')} at ${count(houses, 'other house', 'other houses')}`,
    alsoNoted: (houses: number) =>
      `, noted at ${count(houses, 'other address', 'other addresses')}`,
    infoUpdated: (rows: number) => `Info updated: ${count(rows, 'entry', 'entries')}`,
    newOwner: (name: string) => (name ? `New owner: ${name}` : 'New owner saved'),
    moved: 'House pinned where you are',
    callLogged: (outcome: string) => `Call logged: ${outcome}`,
    noteAdded: 'Note added',
    noteDeleted: 'Note deleted',
    notSaved: 'That wasn’t saved. Nothing changed. Try again.',
  },
  settings: {
    title: 'Settings',
    back: 'Map',
    offlineMap: 'Offline map',
    noMap: 'No offline map loaded. Pins still show, on a plain background.',
    mapKept: (tiles: number) =>
      `The map around every house is kept for no signal (${count(tiles, 'piece', 'pieces')}).`,
    mapKeeping: (kept: number, total: number) =>
      `Keeping the map around every house for no signal… ${kept.toLocaleString('en-CA')} of ${total.toLocaleString('en-CA')}`,
    mapKeptPart: (kept: number, total: number) =>
      `Map kept for no signal: ${kept.toLocaleString('en-CA')} of ${total.toLocaleString('en-CA')} pieces. The rest comes with the next connection.`,
    online: 'Online',
    onlineIntro:
      'Names, phone numbers, parcel IDs, notes and statuses never leave the phone. These switches decide what else may go online.',
    lookUpAddresses: 'Find houses from their address',
    lookUpAddressesHelp:
      'When a file has no coordinates, Terrain asks where each house is: Adresses Québec (Gouvernement du Québec) in Québec, Natural Resources Canada elsewhere in Canada. Only its street, town, postal code and province go online.',
    onlineMap: 'Map from the internet',
    onlineMapHelp:
      'Streets under the pins from OpenFreeMap while there’s a connection, and the map around every house kept on the phone for no signal; a loaded offline map comes first. Only map areas go online.',
    mapInfo: (name: string, bytes: number) => `${name}, ${sizeIn(bytes, 'en-CA', 'MB', 'GB')}`,
    mapZooms: (min: number, max: number) => `Zoom ${String(min)} to ${String(max)}`,
    loadMap: 'Load a map file',
    removeMap: 'Remove the map',
    loadingMap: 'Loading the map file…',
    mapErrors: {
      'not-a-map':
        'This file isn’t an offline map. Pick a .pmtiles file made with npm run basemap.',
      'not-vector':
        'This map file holds pictures, not the map data Terrain draws. Make one with npm run basemap.',
      'no-room': 'The phone has no room left for this map. Free some space, then try again.',
      unsupported: 'This browser can’t keep an offline map. Use Chrome or Brave.',
    } satisfies Record<BasemapErrorCode, string>,
    copyArea: 'Copy campaign area',
    areaHelp:
      'On your computer, in the Terrain folder, run npm run basemap -- followed by this area. It makes the map file to load here.',
    copied: 'Copied.',
    copyFailed: 'Copy didn’t work. Select the area above and copy it.',
    noArea: 'No entry has a position yet. Pin a house at its door first.',
    campaign: 'Campaign',
    backups: 'Backups',
    // Campaigns.
    campaignName: 'Campaign name',
    rename: 'Rename',
    save: 'Save',
    otherCampaigns: 'Other campaigns on this phone',
    campaignRows: (name: string, rows: number) => `${name} · ${count(rows, 'entry', 'entries')}`,
    openCampaign: (name: string) => `Open ${name}`,
    deleteCampaign: 'Delete this campaign',
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody: (rows: number) =>
      `Its ${count(rows, 'entry', 'entries')} and every status, correction, call and note made in it are removed from this phone. Back up first if you may need them.`,
    deleteConfirm: 'Delete campaign',
    // Statuses.
    statuses: 'Statuses',
    statusesHelp:
      'Each status has a label, its pin color as in My Maps (#RRGGBB), the text Terrain writes in Package status, and what it does at the lot’s other addresses.',
    editStatus: (label: string) => `Edit ${label}`,
    moveUp: (label: string) => `Move ${label} up`,
    moveDown: (label: string) => `Move ${label} down`,
    label: 'Label',
    color: 'Color (#RRGGBB)',
    packageText: 'Package status text',
    lotBehavior: 'At the lot’s other addresses',
    lotBehaviors: {
      house: 'Nothing: this house only',
      closes: 'Closes the lot, like Given',
      notes: 'Leaves a note for the co-owners, like To research',
    },
    replaceable: 'A status that closes the lot replaces it',
    asksForNote: 'Asks for a note',
    onRail: 'On the rail',
    notOnRail: 'not on the rail',
    archived: 'archived',
    archive: 'Archive',
    restore: 'Restore',
    startStatus: 'Every entry starts here, and Mark as to visit brings an entry back to it.',
    badColor: 'A color is # then six digits or letters from A to F, like #0F9D58.',
    needLabel: 'A status needs a label.',
    addStatus: 'Add a status',
    newStatus: 'New status',
    // Columns and lots.
    columns: 'Columns',
    columnsHelp:
      'How Edit info shows each column: once for the house, once per parcel ID, or once per owner.',
    groups: { house: 'House', parcel: 'Parcel', person: 'Owner' },
    lots: 'Lots',
    lotColumn: 'Group entries into lots by',
    parcelIdColumn: (lotNumber: string | undefined) =>
      lotNumber ? `Parcel ID and ${lotNumber}` : 'Parcel ID',
    lotsAcross: (n: number) => `${count(n, 'lot is', 'lots are')} at more than one house.`,
    lotVisitDate: 'Entries closed from the lot get Visit date',
    // Calls.
    callOutcomes: 'Call outcomes',
    callOutcomesHelp: 'The buttons after a call, in this order.',
    outcome: (n: number) => `Outcome ${String(n)}`,
    removeOutcome: (outcome: string) => `Remove ${outcome || 'this outcome'}`,
    moveOutcomeUp: (outcome: string) => `Move ${outcome || 'this outcome'} up`,
    addOutcome: 'Add an outcome',
    newOutcome: 'New outcome',
    // Dates and notes.
    datesAndNotes: 'Dates and notes',
    dateFormat: 'Date format',
    notesInExport: 'Notes in the export',
    notesModes: {
      joined: 'Every note, oldest first, each with its date',
      latest: 'The latest note only',
    },
    // Storage and About.
    storage: 'Storage',
    persisted: 'Kept: the browser won’t clear Terrain’s data to free space.',
    notPersisted:
      'Not kept yet: when the phone runs low on space, the browser may clear Terrain’s data.',
    keepData: 'Keep Terrain’s data',
    keepRefused: 'The browser said no. Install Terrain to the home screen, then try again.',
    used: (used: string, quota: string) => `Using ${used} of ${quota} available.`,
    size: (bytes: number) => sizeIn(bytes, 'en-CA', 'MB', 'GB'),
    language: 'Language · Langue',
    languages: { en: 'English', fr: 'Français' },
    about: 'About',
    version: (version: string, built: string) => `Terrain ${version}, built ${built}.`,
    madeBy: 'Designed by Alex Ederer, with help from Claude by Anthropic.',
    license: 'Open source, under the MIT License:',
    questions: 'For any questions:',
  },
  dayLog: {
    open: 'Day log',
    title: 'Day log',
    back: 'Map',
    day: 'Day',
    summary: 'The day in numbers',
    previousDay: 'Previous day with work',
    nextDay: 'Next day with work',
    copy: 'Copy as text',
    share: 'Share',
    copied: 'Day log copied.',
    copyFailed: 'Copy didn’t work on this phone. Use Share instead.',
    notExported: (n: number) =>
      n === 0 ? 'Everything is exported.' : `${count(n, 'change', 'changes')} not exported yet`,
    export: 'Export',
    viaLot: (n: number) => `+${n.toLocaleString('en-CA')} via lot`,
    // The words of the log itself, on screen and in the text it copies.
    words: {
      rows: (n) => count(n, 'entry', 'entries'),
      parcelRows: (parcelId, rows) =>
        rows === 1 ? parcelId : `${parcelId} (${count(rows, 'entry', 'entries')})`,
      infoUpdated: (fields) => `info updated: ${fields}`,
      field: (column, whom) => `${column} (${whom})`,
      moved: (accuracyM) =>
        accuracyM === null
          ? 'pinned where you were'
          : `pinned where you were (${String(Math.round(accuracyM))} m)`,
      call: (number, outcome) => `call ${number}: ${outcome}`,
      otherNumber: 'another number',
      newOwner: (name, previous) => `new owner: ${name} (was ${previous})`,
      note: (text) => `note: ${text}`,
      noteDeleted: (text) => `note deleted: ${text}`,
      forWhom: (text, whom) => `${text} (${whom})`,
      alsoClosed: (address, rows) => `also closed ${address} (${rows})`,
      alsoNoted: (address, rows) => `noted at ${address} (${rows})`,
      ownerOnParcel: (name, parcelId) => `${name}, ${parcelId}`,
      someone: 'someone',
      noAddress: 'No address',
      title: (campaign, day) => `Terrain, ${campaign}, ${day}`,
      statusCount: (status, rows, viaLot) =>
        `${status}: ${count(rows, 'entry', 'entries')}${viaLot > 0 ? ` (+${viaLot.toLocaleString('en-CA')} via lot)` : ''}`,
      corrections: (n) => `Corrections: ${n.toLocaleString('en-CA')}`,
      calls: (n) => `Calls: ${n.toLocaleString('en-CA')}`,
      notes: (n) => `Notes: ${n.toLocaleString('en-CA')}`,
      nothing: 'Nothing recorded this day.',
    } satisfies DayLogWords,
  },
  exports: {
    title: 'Export',
    back: 'Back',
    making: 'Making the file…',
    excel: 'Excel for the client',
    excelHelp:
      'Two sheets: Parcels, every entry with its current values in the client’s columns, and Journal, every change with what it replaced.',
    excelButton: 'Export Excel',
    // Terrain's columns, when the client's file doesn't have them: added at the end of the export.
    appHeaders: {
      packageStatus: 'Package status',
      visitDate: 'Visit date',
      callDate: 'Call date',
      callResult: 'call result',
      notes: 'Notes',
    } satisfies Record<AppRole, string>,
    parcelsSheet: 'Parcels',
    journalSheet: 'Journal',
    myMaps: 'My Maps update',
    myMapsHelp:
      'One file per layer. In My Maps, on a copy of the map: layer menu → Reimport and merge → Replace all items, choose the file, then Parcel ID as the title.',
    layer: (name: string, rows: number) =>
      `${name || 'Layer'} · ${count(rows, 'entry', 'entries')}`,
    byCoordinates: 'Position the pins by Latitude and Longitude.',
    byLocation: 'Position the pins by Location: some pins have only their address.',
    cantPlace: (rows: number) =>
      `${count(rows, 'entry has', 'entries have')} no position and no address: My Maps can’t place ${rows === 1 ? 'it' : 'them'}. Pin ${rows === 1 ? 'that house' : 'those houses'} in Terrain first.`,
    tooBig: (rows: number) =>
      `My Maps imports up to ${rows.toLocaleString('en-CA')} entries per file. Split this layer in My Maps first.`,
    backup: 'Backup',
    backupHelp: 'Everything on this phone, every campaign, to restore here or on a new phone.',
    backupButton: 'Back up',
    shared: (fileName: string) => `Shared ${fileName}.`,
    saved: (fileName: string) => `Saved ${fileName} to your downloads.`,
    failed: 'The file wasn’t made. Nothing changed. Try again.',
  },
  // The Journal sheet of the Excel export, in the client's language for the columns.
  journal: {
    headers: [
      'Date',
      'Time',
      'Parcel ID',
      'Owner',
      'Address',
      'Action',
      'Detail',
      'Previous value',
      'New value',
    ],
    actions: {
      status: 'Status',
      statusViaLot: 'Status via lot',
      lotNote: 'Lot note',
      fieldEdited: 'Field edited',
      newOwner: 'New owner',
      pinMoved: 'Pin moved',
      importUpdate: 'Import update',
      call: 'Call',
      note: 'Note',
      noteDeleted: 'Note deleted',
      undo: 'Undo',
    },
    otherNumber: 'Another number',
    accuracy: (meters) => `GPS, accurate to ${String(Math.round(meters))} m`,
    undid: (action, detail) => (detail ? `${action}: ${detail}` : action),
  } satisfies JournalWords,
  // Lot notes and dated notes also go into exports, in these words.
  notes: {
    lotSpread: (status, who, address, when) => `${status} with ${who} at ${address}, ${when}`,
    lotNote: (status, who, address, when) =>
      `Co-owner ${status.toLowerCase()}: ${who} at ${address}, ${when}`,
    someone: 'someone',
    pinWithoutAddress: (parcelId) => `the ${parcelId} pin`,
    dated: (when, text) => `${when} - ${text}`,
  } satisfies NoteWords,
  backup: {
    backUp: 'Back up',
    saved: (fileName: string) => `Saved ${fileName} to your downloads.`,
    restore: 'Restore from backup',
    title: 'Restore this backup?',
    madeOn: (when: string) => `Backup made ${when}`,
    holds: (campaigns: readonly string[], rows: number) =>
      `${campaigns.length === 0 ? 'No campaign' : campaigns.join(', ')}: ${count(rows, 'entry', 'entries')}`,
    replaces:
      'Everything on this phone is replaced by the backup. Back up first if you need what’s here now.',
    replace: 'Replace with backup',
    failedTitle: 'This backup can’t be restored',
    failed: {
      'not-a-backup': 'This file isn’t a Terrain backup. Pick a Terrain_backup file.',
      'newer-backup': 'This backup comes from a newer Terrain. Update Terrain, then restore it.',
      'damaged-backup': 'This backup is damaged. Nothing was changed. Try an earlier backup.',
      storage:
        'The backup couldn’t be restored. Nothing was changed. Free some space on the phone, then try again.',
    } satisfies Record<RestoreErrorCode | 'storage', string>,
  },
  update: {
    ready: 'Update ready',
    reload: 'Reload',
  },
};

export type Strings = typeof english;

// In French, 0 and 1 take the singular; a colon has a non-breaking space before it.
const compte = (n: number, un: string, plusieurs: string): string =>
  `${n.toLocaleString('fr-CA')} ${n <= 1 ? un : plusieurs}`;
const nombre = (n: number): string => n.toLocaleString('fr-CA');

const french: Strings = {
  appName: 'Terrain',
  rows: (n) => compte(n, 'fiche', 'fiches'),
  houses: (n) => compte(n, 'maison', 'maisons'),
  pins: (n) => compte(n, 'repère', 'repères'),
  noName: 'Sans nom',
  noAddress: 'Sans adresse',
  cancel: 'Annuler',
  continue: 'Continuer',
  home: {
    noCampaign:
      'Importez l’Excel du client, ou un export KMZ de My Maps, pour commencer une campagne.',
    importFile: 'Importer un fichier',
    sampleSentence:
      'Essayez Terrain avec 124 restos de poutine partout au Québec, ou importez un export KMZ de My Maps.',
    trySample: 'Essayer l’exemple poutine',
    openLink: 'Ouvrir un lien My Maps',
    linkLabel: 'Lien My Maps',
    linkHint:
      'Collez le lien de la carte, ou son code « Intégrer à mon site ». La carte doit être partagée : toute personne disposant du lien peut la consulter.',
    linkOpen: 'Ouvrir la carte',
    linkInvalid:
      'Ce n’est pas un lien My Maps. Dans My Maps, choisissez Partager, puis copiez le lien de la carte.',
    linkReading: 'votre carte My Maps',
  },
  reading: (fileName) => `Lecture de ${fileName}…`,
  placing: {
    finding: (n) => `Recherche de ${compte(n, 'maison', 'maisons')} à partir de leur adresse…`,
    progress: (done, total) => `${nombre(done)} sur ${nombre(total)}`,
    what: 'Seuls la rue, la ville, le code postal et la province de chaque maison sortent : vers Adresses Québec, ou Ressources naturelles Canada ailleurs au Canada. Les noms, numéros de téléphone, ID de parcelle et notes restent sur le téléphone.',
    stop: 'Arrêter la recherche',
  },
  failed: {
    title: 'Ce fichier ne peut pas être importé',
    chooseAnother: 'Choisir un autre fichier',
    storage:
      'Terrain ne peut pas enregistrer sur cet appareil. Quittez la navigation privée, ou installez Terrain sur l’écran d’accueil, puis réessayez.',
    unexpected:
      'Un problème est survenu pendant la lecture de ce fichier. Rien n’a été changé. Réessayez, ou exportez de nouveau le fichier de My Maps.',
    reasons: {
      'unsupported-file':
        'Terrain lit les fichiers KMZ et KML de My Maps, et les fichiers Excel ou CSV avec des coordonnées.',
      'damaged-kmz':
        'Ce fichier KMZ est endommagé ou n’est pas un KMZ. Exportez-le de nouveau de My Maps.',
      'no-kml-in-kmz': 'Ce KMZ ne contient aucune carte. Exportez-le de nouveau de My Maps.',
      'network-link-only':
        'Ce fichier ne fait que pointer vers votre carte en ligne; il ne contient aucun repère. Dans My Maps, exportez de nouveau en décochant « Conserver les données à jour avec un lien réseau KML ».',
      'not-kml':
        'Ce fichier ne peut pas être lu comme une carte. Exportez-le de nouveau de My Maps.',
      'no-rows':
        'Ce fichier n’a ni repères ni fiches. Vérifiez que vous avez exporté la bonne carte ou le bon calque de My Maps.',
      'no-coordinates':
        'Ce fichier n’a pas de coordonnées, ni de rue et de ville pour trouver ses maisons. Ajoutez des colonnes Latitude et Longitude, ou des colonnes d’adresse et de ville (ADRESSE et MUNICIPALITE), puis importez-le de nouveau.',
      'unreadable-spreadsheet':
        'Ce tableur ne peut pas être lu. Enregistrez-le de nouveau en .xlsx ou en .csv, puis importez ce fichier.',
    },
    myMapsTitle: 'Cette carte ne peut pas être ouverte',
    anotherLink: 'Essayer un autre lien',
    myMaps: {
      'not-shared':
        'Cette carte n’est pas partagée. Dans My Maps, choisissez Partager et réglez le lien sur « Toute personne disposant du lien peut consulter », puis réessayez. Ou exportez la carte en KMZ et importez ce fichier.',
      'not-found':
        'Google n’a aucune carte à ce lien. Vérifiez le lien, ou exportez la carte en KMZ et importez ce fichier.',
      offline:
        'Ouvrir un lien My Maps demande une connexion. Réessayez avec du réseau, ou importez un fichier KMZ.',
      unexpected:
        'Google n’a pas envoyé la carte. Réessayez dans un moment, ou exportez la carte en KMZ et importez ce fichier.',
    },
  },
  mapping: {
    title: 'Associer les colonnes',
    intro: (fileName) =>
      `Terrain n’a pas trouvé ces colonnes dans ${fileName}. Choisissez la colonne qui contient chacune.`,
    notInFile: 'Pas dans ce fichier',
    // The names of Terrain's columns in the client's template.
    roles: english.mapping.roles,
  },
  colors: {
    title: 'Couleurs des repères',
    intro:
      'Chaque couleur de repère devient un statut. Vérifiez que chaque couleur veut dire ce que Terrain a deviné.',
    noGuess: 'Aucune correspondance : à vérifier',
    seenAs: (texts) => `Package status sur ces repères : ${texts.join(', ')}`,
    statusFor: (color) => `Statut pour ${color}`,
  },
  report: {
    title: 'Rapport d’importation',
    inFile: (rows, fileName) => `${compte(rows, 'fiche', 'fiches')} dans ${fileName}`,
    added: 'Ajoutées',
    updated: 'Mises à jour',
    unchanged: 'Inchangées',
    houses: 'Maisons',
    ownerDetailsChanged: 'Coordonnées du propriétaire changées',
    newOwners: 'Nouveaux propriétaires',
    newOwnersHelp:
      'Quelqu’un d’autre est nommé : la fiche repart au statut du fichier, et le propriétaire d’avant va dans Previous info.',
    newOwner: (previous, next) => `${previous} → ${next}`,
    conflicts: 'Vos corrections que le fichier contredit',
    conflict: (column, local, incoming) =>
      `${column} : la vôtre « ${local} », le fichier « ${incoming || '(vide)'} »`,
    duplicates: 'Fiches en double (même ID de parcelle, propriétaire et adresse)',
    duplicatesHelp: 'Terrain garde les deux fiches. Vérifiez-les dans le fichier du client.',
    missing: 'Fiches absentes de ce fichier',
    missingHelp: 'Elles restent dans la campagne, marquées, après les autres fiches.',
    severalRows: 'Maisons avec plus d’une fiche',
    noPosition: 'Maisons sans position pour l’instant',
    noPositionHelp:
      'Pas de coordonnées dans le fichier, ni d’adresse que Terrain a pu trouver. Elles attendent dans une liste jusqu’à ce que vous épingliez chaque maison à sa porte.',
    placedAtAddress: 'Maisons trouvées à leur adresse',
    placedOnStreet: 'Maisons trouvées sur leur rue seulement',
    placedOnStreetHelp:
      'Le service d’adresses connaît la rue, pas la maison (hors Québec, il estime l’endroit d’après le numéro civique). Vérifiez chacune à la porte : Utiliser ma position la remet au bon endroit.',
    placedFrom:
      'Positions tirées des adresses : Adresses Québec (Gouvernement du Québec, CC BY 4.0) et le Service de géolocalisation de Ressources naturelles Canada (Licence du gouvernement ouvert – Canada).',
    lookUpFailed:
      'Le service d’adresses était inaccessible. Les maisons qu’il n’a pas trouvées attendent sans position : importez de nouveau le fichier avec une connexion pour les chercher.',
    lookUpStopped:
      'Recherche arrêtée. Les maisons non cherchées attendent sans position : importez de nouveau le fichier pour les chercher.',
    lots: 'Parcelles à plus d’une maison',
    severalIds: 'Cellules avec plusieurs ID de parcelle',
    severalIdsHelp:
      'Marquez un ID comme ancien quand il est rayé dans le fichier du client. Une fiche ne rejoint jamais un lot par un ancien ID.',
    markOld: (id) => `${id} est ancien`,
    sharedPoints: 'Maisons différentes au même endroit',
    sharedPointsHelp:
      'Souvent un repli du géocodage, comme le centre du village : ces repères sont probablement au mauvais endroit.',
    spread: 'Maisons dont les fiches sont à plus de 50 m les unes des autres',
    spreadHelp:
      'Souvent des repères déplacés à la main. Terrain montre chaque maison une fois, là où sont la plupart de ses fiches.',
    colors: 'Couleurs des repères',
    reference: (n) =>
      `${compte(n, 'tracé, forme ou trajet', 'tracés, formes et trajets')} en dessin de fond`,
    groupBy: 'Regrouper les fiches en lots par',
    parcelIdOption: (lotNumber) =>
      lotNumber ? `ID de parcelle et ${lotNumber}` : 'ID de parcelle',
    openCampaign: 'Ouvrir la campagne',
    startNew: 'Commencer une nouvelle campagne',
    mostlyNew: 'La plupart des ID de parcelle de ce fichier sont nouveaux pour cette campagne.',
    saving: 'Enregistrement…',
    saveFailed: 'La campagne n’a pas pu être enregistrée. Rien n’a été changé. Réessayez.',
  },
  campaign: {
    summary: (rows, houses) =>
      `${compte(rows, 'fiche', 'fiches')} dans ${compte(houses, 'maison', 'maisons')}`,
    noPosition: (n) => `${compte(n, 'maison', 'maisons')} sans position pour l’instant`,
    lots: (n) => `${compte(n, 'parcelle', 'parcelles')} à plus d’une maison`,
    importFile: 'Importer un fichier',
  },
  map: {
    label: 'Carte de la campagne',
    search: 'Chercher une parcelle, un propriétaire, un lot ou une adresse',
    searchHint: 'Parcelle, nom, lot, adresse',
    clearSearch: 'Effacer la recherche',
    locate: 'Montrer où je suis',
    youreAt: (address) => `Vous êtes au ${address}`,
    menu: 'Paramètres',
    noBasemap: 'Aucune carte hors ligne chargée. Ajoutez-en une dans les Paramètres.',
    filters: 'Montrer les maisons par statut',
    allStatuses: 'Toutes',
    chip: (label, rows) => `${label} ${nombre(rows)}`,
    notOnMap: (n) => `${compte(n, 'maison', 'maisons')} hors de la carte`,
    notOnMapTitle: 'Maisons sans position pour l’instant',
    notOnMapHelp:
      'Pas de coordonnées dans le fichier, ni d’adresse que Terrain a pu trouver. Ouvrez-en une à la porte pour l’épingler là.',
    onStreet: (n) => `${compte(n, 'maison', 'maisons')} sur la rue seulement`,
    onStreetTitle: 'Maisons trouvées sur leur rue seulement',
    onStreetHelp:
      'Le service d’adresses connaît la rue, pas la maison. Ouvrez-en une à la porte pour l’épingler là.',
    chooserTitle: (n) => `${nombre(n)} maisons à cet endroit`,
    chooserHelp:
      'Des adresses différentes sur un même point, souvent le centre du village. Ces repères sont probablement au mauvais endroit.',
    close: 'Fermer',
    noResults:
      'Rien ne correspond. Essayez un ID de parcelle, un propriétaire, un numéro de lot ou une adresse.',
    lotResult: (column, value, houses) =>
      `${column} ${value} : ${compte(houses, 'maison', 'maisons')}`,
    lotTitle: (column, value) => `${column} ${value}`,
    rowMatch: (parcelId, name) => `${parcelId}  ${name}`,
    locationDenied:
      'Terrain ne voit pas où vous êtes. Autorisez la localisation pour ce site dans les paramètres du navigateur.',
    locationWaiting: 'En attente du GPS…',
  },
  card: {
    rows: (n) => compte(n, 'fiche', 'fiches'),
    close: 'Fermer',
    more: 'Tout afficher',
    less: 'Afficher moins',
    alsoAt: (parcelId, address, owners) => `${parcelId} aussi au ${address} : ${owners}`,
    ownerStatus: (name, status) => `${name}, ${status.toLowerCase()}`,
    previousInfo: 'Infos précédentes',
    notInLatestFile: 'Absente du dernier fichier du client',
    noAddress: 'Sans adresse',
    noName: 'Sans nom',
    noPosition: 'Pas encore sur la carte',
    onStreet:
      'Trouvée sur la rue seulement, à partir de l’adresse : vérifiez à la porte, puis Utiliser ma position.',
    statusLine: (status, when) => (when ? `${status}, ${when}` : status),
    rail: 'Marquer la maison',
    rowRail: 'Cette fiche seulement',
    via: (address) => `par ${address}`,
    call: 'Appeler',
    logCall: 'Noter un appel',
    note: 'Note',
    navigate: 'Itinéraire',
    noNumber:
      'Aucun numéro de téléphone au dossier pour cette maison. Notez l’appel pour toute la maison ci-dessous.',
    pinHere: (accuracy) =>
      accuracy
        ? `Utiliser ma position, précise à ${accuracy} m`
        : 'Utiliser ma position pour cette maison',
    pinHelp: 'Tenez-vous à la porte : la maison se déplace là où est le téléphone.',
    waitingForGps: 'En attente du GPS…',
    noteForRow: 'Note pour cette fiche',
    editRow: 'Modifier cette fiche',
    markRowToVisit: 'Remettre à visiter',
    markHouseToVisit: 'Remettre la maison à visiter',
    editInfo: 'Modifier les infos',
    noValue: 'Aucune valeur',
    edited: 'modifié',
    imported: (value) => `Importé : ${value || '(vide)'}`,
    fields: 'Information',
    lotSection: 'Même parcelle à d’autres adresses',
    distance: (meters) =>
      meters < 1000
        ? `${nombre(Math.round(meters))} m`
        : `${(meters / 1000).toLocaleString('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`,
    open: 'Ouvrir',
    showOnMap: 'Voir sur la carte',
    notes: 'Notes',
    noNotes: 'Aucune note pour l’instant.',
    allRows: (n) => `Les ${nombre(n)} fiches`,
    lotMark: 'Lot',
    importedMark: 'Du fichier',
    deleteHint: 'Appuyez longuement sur une note pour la supprimer.',
    pendingCall: (number) => `Noter le résultat de l’appel : ${number}`,
  },
  calls: {
    choose: 'Quel numéro?',
    chooseToLog: 'Quel numéro avez-vous appelé?',
    home: 'Domicile',
    numberLabel: (kind, owners) =>
      kind === 'home'
        ? 'Domicile'
        : `${owners.join(' / ')}, ${kind === 'cell' ? 'cellulaire' : kind === 'work' ? 'travail' : kind}`,
    wholeHouse: 'Un autre numéro : toute la maison',
    outcome: (number) =>
      number ? `Comment s’est passé l’appel au ${number}?` : 'Comment s’est passé l’appel?',
    discard: 'Oublier cet appel',
  },
  noteEditor: {
    forHouse: (n, address) => `Note pour ${compte(n, 'fiche', 'fiches')} au ${address}`,
    forRow: (name) => `Note pour ${name}`,
    save: 'Enregistrer la note',
    deleteTitle: 'Supprimer cette note?',
    deleteBody: 'Elle quitte toutes les fiches qu’elle couvre. L’historique la garde.',
    delete: 'Supprimer la note',
  },
  edit: {
    editShort: 'Modifier',
    title: (address) => `Modifier les infos : ${address}`,
    rowTitle: (name) => `Modifier cette fiche : ${name}`,
    house: 'Pareil pour toute la maison',
    parcel: (parcelId) => `Parcelle ${parcelId}`,
    differs: 'diffère',
    save: 'Enregistrer',
    nothing: 'Rien n’a changé.',
    newOwner: 'Nouveau propriétaire',
    newOwnerHelp: (previous, restart) =>
      [
        previous && `${previous} va dans Previous info à l’enregistrement.`,
        restart && `Cette visite était la sienne : la fiche revient à ${restart}.`,
        'Inscrivez le nom et les numéros du nouveau propriétaire.',
      ]
        .filter(Boolean)
        .join(' '),
  },
  // Written into the client's files: in English (`clientWords`).
  previousInfo: english.previousInfo,
  toast: {
    undo: 'Annuler',
    rowMarked: (parcelId, status) => `${parcelId} : ${status}`,
    houseMarked: (status, rows, address) =>
      `${status} : ${compte(rows, 'fiche', 'fiches')} au ${address}`,
    alsoClosed: (rows, address, houses) =>
      address
        ? ` et ${compte(rows, 'fiche', 'fiches')} au ${address}`
        : ` et ${compte(rows, 'fiche', 'fiches')} à ${compte(houses, 'autre maison', 'autres maisons')}`,
    alsoNoted: (houses) => `, noté à ${compte(houses, 'autre adresse', 'autres adresses')}`,
    infoUpdated: (rows) => `Infos modifiées : ${compte(rows, 'fiche', 'fiches')}`,
    newOwner: (name) =>
      name ? `Nouveau propriétaire : ${name}` : 'Nouveau propriétaire enregistré',
    moved: 'Maison épinglée là où vous êtes',
    callLogged: (outcome) => `Appel noté : ${outcome}`,
    noteAdded: 'Note ajoutée',
    noteDeleted: 'Note supprimée',
    notSaved: 'Ça n’a pas été enregistré. Rien n’a changé. Réessayez.',
  },
  settings: {
    title: 'Paramètres',
    back: 'Carte',
    offlineMap: 'Carte hors ligne',
    noMap: 'Aucune carte hors ligne chargée. Les repères s’affichent quand même, sur un fond uni.',
    mapKept: (tiles) =>
      `La carte autour de chaque maison est gardée pour quand il n’y a pas de réseau (${compte(tiles, 'morceau', 'morceaux')}).`,
    mapKeeping: (kept, total) =>
      `Mise de côté de la carte autour de chaque maison pour quand il n’y a pas de réseau… ${nombre(kept)} sur ${nombre(total)}`,
    mapKeptPart: (kept, total) =>
      `Carte gardée pour quand il n’y a pas de réseau : ${nombre(kept)} morceaux sur ${nombre(total)}. Le reste viendra à la prochaine connexion.`,
    online: 'En ligne',
    onlineIntro:
      'Les noms, numéros de téléphone, ID de parcelle, notes et statuts ne quittent jamais le téléphone. Ces interrupteurs décident de ce qui d’autre peut aller en ligne.',
    lookUpAddresses: 'Trouver les maisons à partir de leur adresse',
    lookUpAddressesHelp:
      'Quand un fichier n’a pas de coordonnées, Terrain demande où est chaque maison : Adresses Québec (Gouvernement du Québec) au Québec, Ressources naturelles Canada ailleurs au Canada. Seuls sa rue, sa ville, son code postal et sa province vont en ligne.',
    onlineMap: 'Carte venant d’Internet',
    onlineMapHelp:
      'Les rues sous les repères viennent d’OpenFreeMap quand il y a une connexion, et la carte autour de chaque maison est gardée sur le téléphone pour quand il n’y a pas de réseau; une carte hors ligne chargée passe en premier. Seules des zones de carte vont en ligne.',
    mapInfo: (name, bytes) => `${name}, ${sizeIn(bytes, 'fr-CA', 'Mo', 'Go')}`,
    mapZooms: (min, max) => `Zoom ${String(min)} à ${String(max)}`,
    loadMap: 'Charger un fichier de carte',
    removeMap: 'Retirer la carte',
    loadingMap: 'Chargement du fichier de carte…',
    mapErrors: {
      'not-a-map':
        'Ce fichier n’est pas une carte hors ligne. Choisissez un fichier .pmtiles fait avec npm run basemap.',
      'not-vector':
        'Ce fichier de carte contient des images, pas les données de carte que Terrain dessine. Faites-en un avec npm run basemap.',
      'no-room':
        'Le téléphone n’a plus de place pour cette carte. Libérez de l’espace, puis réessayez.',
      unsupported:
        'Ce navigateur ne peut pas garder une carte hors ligne. Utilisez Chrome ou Brave.',
    },
    copyArea: 'Copier la zone de la campagne',
    areaHelp:
      'Sur votre ordinateur, dans le dossier Terrain, lancez npm run basemap -- suivi de cette zone. Ça crée le fichier de carte à charger ici.',
    copied: 'Copié.',
    copyFailed: 'La copie n’a pas fonctionné. Sélectionnez la zone ci-dessus et copiez-la.',
    noArea: 'Aucune fiche n’a encore de position. Épinglez d’abord une maison à sa porte.',
    campaign: 'Campagne',
    backups: 'Sauvegardes',
    campaignName: 'Nom de la campagne',
    rename: 'Renommer',
    save: 'Enregistrer',
    otherCampaigns: 'Autres campagnes sur ce téléphone',
    campaignRows: (name, rows) => `${name} · ${compte(rows, 'fiche', 'fiches')}`,
    openCampaign: (name) => `Ouvrir ${name}`,
    deleteCampaign: 'Supprimer cette campagne',
    deleteTitle: (name) => `Supprimer ${name}?`,
    deleteBody: (rows) =>
      `Cette campagne (${compte(rows, 'fiche', 'fiches')}) et chaque statut, correction, appel et note qu’on y a faits sont retirés de ce téléphone. Sauvegardez d’abord si vous pourriez en avoir besoin.`,
    deleteConfirm: 'Supprimer la campagne',
    statuses: 'Statuts',
    statusesHelp:
      'Chaque statut a un libellé, la couleur de son repère comme dans My Maps (#RRGGBB), le texte que Terrain écrit dans Package status, et ce qu’il fait aux autres adresses du lot.',
    editStatus: (label) => `Modifier ${label}`,
    moveUp: (label) => `Monter ${label}`,
    moveDown: (label) => `Descendre ${label}`,
    label: 'Libellé',
    color: 'Couleur (#RRGGBB)',
    packageText: 'Texte de Package status',
    lotBehavior: 'Aux autres adresses du lot',
    lotBehaviors: {
      house: 'Rien : cette maison seulement',
      closes: 'Ferme le lot, comme Given',
      notes: 'Laisse une note aux copropriétaires, comme To research',
    },
    replaceable: 'Un statut qui ferme le lot le remplace',
    asksForNote: 'Demande une note',
    onRail: 'Sur le rail',
    notOnRail: 'pas sur le rail',
    archived: 'archivé',
    archive: 'Archiver',
    restore: 'Rétablir',
    startStatus: 'Chaque fiche commence ici, et Remettre à visiter y ramène une fiche.',
    badColor: 'Une couleur, c’est # puis six chiffres ou lettres de A à F, comme #0F9D58.',
    needLabel: 'Un statut a besoin d’un libellé.',
    addStatus: 'Ajouter un statut',
    newStatus: 'Nouveau statut',
    columns: 'Colonnes',
    columnsHelp:
      'Comment Modifier les infos montre chaque colonne : une fois pour la maison, une fois par ID de parcelle, ou une fois par propriétaire.',
    groups: { house: 'Maison', parcel: 'Parcelle', person: 'Propriétaire' },
    lots: 'Lots',
    lotColumn: 'Regrouper les fiches en lots par',
    parcelIdColumn: (lotNumber) =>
      lotNumber ? `ID de parcelle et ${lotNumber}` : 'ID de parcelle',
    lotsAcross: (n) => `${compte(n, 'lot est', 'lots sont')} à plus d’une maison.`,
    lotVisitDate: 'Les fiches fermées par le lot reçoivent Visit date',
    callOutcomes: 'Résultats d’appel',
    callOutcomesHelp: 'Les boutons après un appel, dans cet ordre.',
    outcome: (n) => `Résultat ${String(n)}`,
    removeOutcome: (outcome) => `Retirer ${outcome || 'ce résultat'}`,
    moveOutcomeUp: (outcome) => `Monter ${outcome || 'ce résultat'}`,
    addOutcome: 'Ajouter un résultat',
    newOutcome: 'Nouveau résultat',
    datesAndNotes: 'Dates et notes',
    dateFormat: 'Format de date',
    notesInExport: 'Notes dans l’export',
    notesModes: {
      joined: 'Toutes les notes, la plus ancienne d’abord, chacune avec sa date',
      latest: 'La dernière note seulement',
    },
    storage: 'Stockage',
    persisted:
      'Gardé : le navigateur n’effacera pas les données de Terrain pour libérer de l’espace.',
    notPersisted:
      'Pas encore gardé : quand le téléphone manque d’espace, le navigateur peut effacer les données de Terrain.',
    keepData: 'Garder les données de Terrain',
    keepRefused: 'Le navigateur a refusé. Installez Terrain sur l’écran d’accueil, puis réessayez.',
    used: (used, quota) => `${used} utilisés sur ${quota} disponibles.`,
    size: (bytes) => sizeIn(bytes, 'fr-CA', 'Mo', 'Go'),
    language: 'Language · Langue',
    languages: english.settings.languages,
    about: 'À propos',
    version: (version, built) => `Terrain ${version}, compilé le ${built}.`,
    madeBy: 'Conçu par Alex Ederer, avec l’aide de Claude d’Anthropic.',
    license: 'Code source libre, sous licence MIT :',
    questions: 'Pour toute question :',
  },
  dayLog: {
    open: 'Journal du jour',
    title: 'Journal du jour',
    back: 'Carte',
    day: 'Jour',
    summary: 'La journée en chiffres',
    previousDay: 'Jour de travail précédent',
    nextDay: 'Jour de travail suivant',
    copy: 'Copier en texte',
    share: 'Partager',
    copied: 'Journal du jour copié.',
    copyFailed: 'La copie n’a pas fonctionné sur ce téléphone. Utilisez Partager.',
    notExported: (n) =>
      n === 0
        ? 'Tout est exporté.'
        : compte(n, 'changement pas encore exporté', 'changements pas encore exportés'),
    export: 'Exporter',
    viaLot: (n) => `+${nombre(n)} par le lot`,
    // The words of the log itself, on screen and in the text it copies.
    words: {
      rows: (n) => compte(n, 'fiche', 'fiches'),
      parcelRows: (parcelId, rows) =>
        rows === 1 ? parcelId : `${parcelId} (${compte(rows, 'fiche', 'fiches')})`,
      infoUpdated: (fields) => `infos modifiées : ${fields}`,
      field: (column, whom) => `${column} (${whom})`,
      moved: (accuracyM) =>
        accuracyM === null
          ? 'épinglée là où vous étiez'
          : `épinglée là où vous étiez (${String(Math.round(accuracyM))} m)`,
      call: (number, outcome) => `appel ${number} : ${outcome}`,
      otherNumber: 'un autre numéro',
      newOwner: (name, previous) => `nouveau propriétaire : ${name} (avant : ${previous})`,
      note: (text) => `note : ${text}`,
      noteDeleted: (text) => `note supprimée : ${text}`,
      forWhom: (text, whom) => `${text} (${whom})`,
      alsoClosed: (address, rows) => `aussi fermé au ${address} (${rows})`,
      alsoNoted: (address, rows) => `noté au ${address} (${rows})`,
      ownerOnParcel: (name, parcelId) => `${name}, ${parcelId}`,
      someone: 'quelqu’un',
      noAddress: 'Sans adresse',
      title: (campaign, day) => `Terrain, ${campaign}, ${day}`,
      statusCount: (status, rows, viaLot) =>
        `${status} : ${compte(rows, 'fiche', 'fiches')}${viaLot > 0 ? ` (+${nombre(viaLot)} par le lot)` : ''}`,
      corrections: (n) => `Corrections : ${nombre(n)}`,
      calls: (n) => `Appels : ${nombre(n)}`,
      notes: (n) => `Notes : ${nombre(n)}`,
      nothing: 'Rien d’inscrit ce jour-là.',
    },
  },
  exports: {
    title: 'Exporter',
    back: 'Retour',
    making: 'Création du fichier…',
    excel: 'Excel pour le client',
    excelHelp:
      'Deux feuilles : Parcels, chaque fiche avec ses valeurs actuelles dans les colonnes du client, et Journal, chaque changement avec ce qu’il a remplacé.',
    excelButton: 'Exporter l’Excel',
    // Written into the client's files: in English (`clientWords`).
    appHeaders: english.exports.appHeaders,
    parcelsSheet: english.exports.parcelsSheet,
    journalSheet: english.exports.journalSheet,
    myMaps: 'Mise à jour My Maps',
    myMapsHelp:
      'Un fichier par calque. Dans My Maps, sur une copie de la carte : menu du calque → Réimporter et fusionner → Remplacer tous les éléments, choisissez le fichier, puis Parcel ID comme titre.',
    layer: (name, rows) => `${name || 'Calque'} · ${compte(rows, 'fiche', 'fiches')}`,
    byCoordinates: 'Placez les repères par Latitude et Longitude.',
    byLocation: 'Placez les repères par Location : certains repères n’ont que leur adresse.',
    cantPlace: (rows) =>
      `${compte(rows, 'fiche n’a', 'fiches n’ont')} ni position ni adresse : My Maps ne peut pas ${rows <= 1 ? 'la' : 'les'} placer. Épinglez d’abord ${rows <= 1 ? 'cette maison' : 'ces maisons'} dans Terrain.`,
    tooBig: (rows) =>
      `My Maps importe jusqu’à ${nombre(rows)} fiches par fichier. Divisez d’abord ce calque dans My Maps.`,
    backup: 'Sauvegarde',
    backupHelp:
      'Tout ce qui est sur ce téléphone, chaque campagne, pour restaurer ici ou sur un nouveau téléphone.',
    backupButton: 'Sauvegarder',
    shared: (fileName) => `${fileName} partagé.`,
    saved: (fileName) => `${fileName} enregistré dans vos téléchargements.`,
    failed: 'Le fichier n’a pas été créé. Rien n’a changé. Réessayez.',
  },
  // Written into the client's files: in English (`clientWords`).
  journal: english.journal,
  // On the card's notes; the exports write them in English (`clientWords`).
  notes: {
    lotSpread: (status, who, address, when) => `${status} avec ${who} au ${address}, ${when}`,
    lotNote: (status, who, address, when) =>
      `Copropriétaire ${status.toLowerCase()} : ${who} au ${address}, ${when}`,
    someone: 'quelqu’un',
    pinWithoutAddress: (parcelId) => `le repère ${parcelId}`,
    dated: (when, text) => `${when} - ${text}`,
  },
  backup: {
    backUp: 'Sauvegarder',
    saved: (fileName) => `${fileName} enregistré dans vos téléchargements.`,
    restore: 'Restaurer une sauvegarde',
    title: 'Restaurer cette sauvegarde?',
    madeOn: (when) => `Sauvegarde faite le ${when}`,
    holds: (campaigns, rows) =>
      `${campaigns.length === 0 ? 'Aucune campagne' : campaigns.join(', ')} : ${compte(rows, 'fiche', 'fiches')}`,
    replaces:
      'Tout ce qui est sur ce téléphone est remplacé par la sauvegarde. Sauvegardez d’abord si vous avez besoin de ce qui s’y trouve.',
    replace: 'Remplacer par la sauvegarde',
    failedTitle: 'Cette sauvegarde ne peut pas être restaurée',
    failed: {
      'not-a-backup':
        'Ce fichier n’est pas une sauvegarde Terrain. Choisissez un fichier Terrain_backup.',
      'newer-backup':
        'Cette sauvegarde vient d’un Terrain plus récent. Mettez Terrain à jour, puis restaurez-la.',
      'damaged-backup':
        'Cette sauvegarde est endommagée. Rien n’a été changé. Essayez une sauvegarde plus ancienne.',
      storage:
        'La sauvegarde n’a pas pu être restaurée. Rien n’a été changé. Libérez de l’espace sur le téléphone, puis réessayez.',
    },
  },
  update: {
    ready: 'Mise à jour prête',
    reload: 'Recharger',
  },
};

export type Language = 'en' | 'fr';

/** The words on screen: English or French, as chosen in Settings, else the phone's language. */
export let strings: Strings = english;

/** The words of the files for the client: always English (Alex, 2026-10-06), like their template. */
export const clientWords: Strings = english;

/** The screen's language, for what must follow it at once. */
export const language = signal<Language>('en');

/** French when the phone speaks French, English otherwise. */
export function phoneLanguage(): Language {
  // Outside a browser (the unit tests), English.
  if (typeof document === 'undefined') return 'en';
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function setLanguage(next: Language): void {
  strings = next === 'fr' ? french : english;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  language.value = next;
}

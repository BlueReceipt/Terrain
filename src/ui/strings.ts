import type { RestoreErrorCode } from '../data/backup.ts';
import type { BasemapErrorCode } from '../data/basemap.ts';
import type { ImportErrorCode } from '../domain/errors.ts';
import type { DayLogWords } from '../domain/daylog.ts';
import type { JournalWords } from '../domain/export/journal.ts';
import type { NoteWords } from '../domain/notes.ts';
import type { AppRole, FieldRole } from '../domain/types.ts';

const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-CA')} ${n === 1 ? one : many}`;

// Every user-facing string lives here so a French UI can follow (BUILD_SPEC §4).
export const strings = {
  appName: 'Terrain',
  rows: (n: number) => count(n, 'row', 'rows'),
  houses: (n: number) => count(n, 'house', 'houses'),
  pins: (n: number) => count(n, 'pin', 'pins'),
  noName: 'No name',
  noAddress: 'No address',
  cancel: 'Cancel',
  continue: 'Continue',
  home: {
    noCampaign: 'Import a KMZ export from My Maps to start a campaign.',
    importFile: 'Import file',
  },
  reading: (fileName: string) => `Reading ${fileName}…`,
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
        'This file has no pins or rows. Check that you exported the right map or layer from My Maps.',
      'no-coordinates':
        'This file has no coordinates. Import it into My Maps once, then export the layer as KMZ and import that here.',
      'unreadable-spreadsheet':
        'This spreadsheet can’t be read. Save it again as .xlsx or .csv and import that.',
    } satisfies Record<ImportErrorCode, string>,
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
    inFile: (rows: number, fileName: string) => `${count(rows, 'row', 'rows')} in ${fileName}`,
    added: 'Added',
    updated: 'Updated',
    unchanged: 'Unchanged',
    houses: 'Houses',
    ownerDetailsChanged: 'Owner details changed',
    conflicts: 'Your corrections the file disagrees with',
    conflict: (column: string, local: string, incoming: string) =>
      `${column}: yours “${local}”, file “${incoming || '(blank)'}”`,
    duplicates: 'Rows listed twice (same parcel ID, owner and address)',
    duplicatesHelp: 'Terrain keeps both rows. Check them in the client’s file.',
    missing: 'Rows missing from this file',
    missingHelp: 'They stay in the campaign, flagged, after the other rows.',
    severalRows: 'Houses with more than one row',
    noPosition: 'Houses with no position yet',
    noPositionHelp:
      'My Maps exported these pins without coordinates. They wait in a list until you pin each house at the door.',
    lots: 'Parcels at more than one house',
    severalIds: 'Cells listing several parcel IDs',
    severalIdsHelp:
      'Mark an ID as old when it’s crossed out in the client’s file. A row never joins a lot through an old ID.',
    markOld: (id: string) => `${id} is old`,
    sharedPoints: 'Different houses on one spot',
    sharedPointsHelp:
      'Usually a geocoding fallback such as a village center: these pins are probably in the wrong place.',
    spread: 'Houses whose rows are more than 50 m apart',
    spreadHelp:
      'Often pins pulled apart by hand. Terrain shows each house once, where most of its rows are.',
    colors: 'Pin colors',
    reference: (n: number) =>
      `${count(n, 'line, shape or route', 'lines, shapes and routes')} shown as a background drawing`,
    groupBy: 'Group rows into lots by',
    parcelIdOption: 'Parcel ID',
    openCampaign: 'Open campaign',
    startNew: 'Start a new campaign',
    mostlyNew: 'Most parcel IDs in this file are new to this campaign.',
    saving: 'Saving…',
    saveFailed: 'The campaign couldn’t be saved. Nothing was changed. Try again.',
  },
  campaign: {
    summary: (rows: number, houses: number) =>
      `${count(rows, 'row', 'rows')} at ${count(houses, 'house', 'houses')}`,
    noPosition: (n: number) => `${count(n, 'house', 'houses')} with no position yet`,
    lots: (n: number) => `${count(n, 'parcel', 'parcels')} at more than one house`,
    importFile: 'Import file',
  },
  map: {
    label: 'Map of the campaign',
    search: 'Search parcel, owner, lot or address',
    clearSearch: 'Clear the search',
    locate: 'Show where I am',
    menu: 'Settings',
    noBasemap: 'No offline map loaded. Add one in Settings.',
    filters: 'Show houses by status',
    allStatuses: 'All',
    chip: (label: string, rows: number) => `${label} ${rows.toLocaleString('en-CA')}`,
    notOnMap: (n: number) => `${count(n, 'house', 'houses')} not on the map`,
    notOnMapTitle: 'Houses with no position yet',
    notOnMapHelp:
      'My Maps exported these pins without coordinates. Open one at the door to pin it there.',
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
    rows: (n: number) => count(n, 'row', 'rows'),
    close: 'Close',
    more: 'Show everything',
    less: 'Show less',
    alsoAt: (parcelId: string, address: string, owners: string) =>
      `${parcelId} also at ${address}: ${owners}`,
    ownerStatus: (name: string, status: string) => `${name}, ${status.toLowerCase()}`,
    noAddress: 'No address',
    noName: 'No name',
    noPosition: 'Not on the map yet',
    statusLine: (status: string, when: string) => (when ? `${status}, ${when}` : status),
    rail: 'Mark the house',
    rowRail: 'This row only',
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
    noteForRow: 'Note for this row',
    editRow: 'Edit this row',
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
    allRows: (n: number) => `All ${String(n)} rows`,
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
    forHouse: (n: number, address: string) => `Note for ${count(n, 'row', 'rows')} at ${address}`,
    forRow: (name: string) => `Note for ${name}`,
    save: 'Save note',
    deleteTitle: 'Delete this note?',
    deleteBody: 'It leaves every row it covers. The history keeps it.',
    delete: 'Delete note',
  },
  edit: {
    editShort: 'Edit',
    title: (address: string) => `Edit info: ${address}`,
    rowTitle: (name: string) => `Edit this row: ${name}`,
    house: 'Same for the whole house',
    parcel: (parcelId: string) => `Parcel ${parcelId}`,
    differs: 'differs',
    save: 'Save changes',
    nothing: 'Nothing changed.',
  },
  toast: {
    undo: 'Undo',
    rowMarked: (parcelId: string, status: string) => `${parcelId} marked ${status.toLowerCase()}`,
    houseMarked: (status: string, rows: number, address: string) =>
      `${status}: ${count(rows, 'row', 'rows')} at ${address}`,
    alsoClosed: (rows: number, address: string | null, houses: number) =>
      address
        ? ` and ${count(rows, 'row', 'rows')} at ${address}`
        : ` and ${count(rows, 'row', 'rows')} at ${count(houses, 'other house', 'other houses')}`,
    alsoNoted: (houses: number) =>
      `, noted at ${count(houses, 'other address', 'other addresses')}`,
    infoUpdated: (rows: number) => `Info updated: ${count(rows, 'row', 'rows')}`,
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
    mapInfo: (name: string, megabytes: string) => `${name}, ${megabytes} MB`,
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
    noArea: 'No row has a position yet. Pin a house at its door first.',
    campaign: 'Campaign',
    backups: 'Backups',
    // Campaigns (§5.9).
    campaignName: 'Campaign name',
    rename: 'Rename',
    save: 'Save',
    otherCampaigns: 'Other campaigns on this phone',
    campaignRows: (name: string, rows: number) => `${name} · ${count(rows, 'row', 'rows')}`,
    openCampaign: (name: string) => `Open ${name}`,
    deleteCampaign: 'Delete this campaign',
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody: (rows: number) =>
      `Its ${count(rows, 'row', 'rows')} and every status, correction, call and note made in it are removed from this phone. Back up first if you may need them.`,
    deleteConfirm: 'Delete campaign',
    // Statuses (§5.9).
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
    startStatus: 'Every row starts here, and Mark as to visit brings a row back to it.',
    badColor: 'A color is # then six digits or letters from A to F, like #0F9D58.',
    needLabel: 'A status needs a label.',
    addStatus: 'Add a status',
    newStatus: 'New status',
    // Columns and lots (§5.9).
    columns: 'Columns',
    columnsHelp:
      'How Edit info shows each column: once for the house, once per parcel ID, or once per owner.',
    groups: { house: 'House', parcel: 'Parcel', person: 'Owner' },
    lots: 'Lots',
    lotColumn: 'Group rows into lots by',
    parcelIdColumn: 'Parcel ID',
    lotsAcross: (n: number) => `${count(n, 'lot is', 'lots are')} at more than one house.`,
    lotVisitDate: 'Rows closed from the lot get Visit date',
    // Calls (§5.9).
    callOutcomes: 'Call outcomes',
    callOutcomesHelp: 'The buttons after a call, in this order.',
    outcome: (n: number) => `Outcome ${String(n)}`,
    removeOutcome: (outcome: string) => `Remove ${outcome || 'this outcome'}`,
    moveOutcomeUp: (outcome: string) => `Move ${outcome || 'this outcome'} up`,
    addOutcome: 'Add an outcome',
    newOutcome: 'New outcome',
    // Dates and notes (§5.9).
    datesAndNotes: 'Dates and notes',
    dateFormat: 'Date format',
    notesInExport: 'Notes in the export',
    notesModes: {
      joined: 'Every note, oldest first, each with its date',
      latest: 'The latest note only',
    },
    // Storage and About (§5.9, §8).
    storage: 'Storage',
    persisted: 'Kept: the browser won’t clear Terrain’s data to free space.',
    notPersisted:
      'Not kept yet: when the phone runs low on space, the browser may clear Terrain’s data.',
    keepData: 'Keep Terrain’s data',
    keepRefused: 'The browser said no. Install Terrain to the home screen, then try again.',
    used: (used: string, quota: string) => `Using ${used} of ${quota} available.`,
    about: 'About',
    version: (version: string, built: string) => `Terrain ${version}, built ${built}.`,
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
    // The words of the log itself, on screen and in the text it copies (§5.7).
    words: {
      rows: (n) => count(n, 'row', 'rows'),
      parcelRows: (parcelId, rows) =>
        rows === 1 ? parcelId : `${parcelId} (${count(rows, 'row', 'rows')})`,
      infoUpdated: (fields) => `info updated: ${fields}`,
      field: (column, whom) => `${column} (${whom})`,
      moved: (accuracyM) =>
        accuracyM === null
          ? 'pinned where you were'
          : `pinned where you were (${String(Math.round(accuracyM))} m)`,
      call: (number, outcome) => `call ${number}: ${outcome}`,
      otherNumber: 'another number',
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
        `${status}: ${count(rows, 'row', 'rows')}${viaLot > 0 ? ` (+${viaLot.toLocaleString('en-CA')} via lot)` : ''}`,
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
      'Two sheets: Parcels, every row with its current values in the client’s columns, and Journal, every change with what it replaced.',
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
    layer: (name: string, rows: number) => `${name || 'Layer'} · ${count(rows, 'row', 'rows')}`,
    byCoordinates: 'Position the pins by Latitude and Longitude.',
    byLocation: 'Position the pins by Location: some pins have only their address.',
    cantPlace: (rows: number) =>
      `${count(rows, 'row has', 'rows have')} no position and no address: My Maps can’t place ${rows === 1 ? 'it' : 'them'}. Pin ${rows === 1 ? 'that house' : 'those houses'} in Terrain first.`,
    tooBig: (rows: number) =>
      `My Maps imports up to ${rows.toLocaleString('en-CA')} rows per file. Split this layer in My Maps first.`,
    backup: 'Backup',
    backupHelp: 'Everything on this phone, every campaign, to restore here or on a new phone.',
    backupButton: 'Back up',
    shared: (fileName: string) => `Shared ${fileName}.`,
    saved: (fileName: string) => `Saved ${fileName} to your downloads.`,
    failed: 'The file wasn’t made. Nothing changed. Try again.',
  },
  // The Journal sheet of the Excel export (§5.8), in the client's language for the columns.
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
  // Lot notes and dated notes also go into exports, in these words (§5.6, §5.10).
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
      `${campaigns.length === 0 ? 'No campaign' : campaigns.join(', ')}: ${count(rows, 'row', 'rows')}`,
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
} as const;

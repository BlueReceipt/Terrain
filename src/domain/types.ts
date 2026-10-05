export interface LatLng {
  lat: number;
  lng: number;
}

/** A status the rail can mark. */
export interface Status {
  id: string;
  label: string;
  /** '#RRGGBB', matched against My Maps pin colors. */
  color: string;
  packageStatusText: string;
  /** 'lot': a tap also marks the same lots' rows at other houses (Given). */
  scope: 'house' | 'lot';
  /** A whole-lot status marked elsewhere on the lot replaces this one. */
  replaceableByLot: boolean;
  /**
   * A tap leaves a note on the same lots' rows at other houses without changing them, so the next
   * visit there can ask about it ("co-owner to research", Alex, 2026-10-01).
   */
  notesLot: boolean;
  asksForNote: boolean;
  isStartStatus: boolean;
  /** On the status rail. To visit comes back through "Mark as to visit"; Not given only from imported pins. */
  onRail: boolean;
  archived: boolean;
  order: number;
}

/** The app-owned columns. */
export type AppRole = 'packageStatus' | 'visitDate' | 'callDate' | 'callResult' | 'notes';

/** Columns Terrain reads to recognize owners, houses, lots and positions. */
export type FieldRole =
  | AppRole
  | 'parcelId'
  | 'lat'
  | 'lng'
  | 'wkt'
  | 'street'
  | 'town'
  | 'province'
  | 'postalCode'
  | 'salutation'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'homePhone'
  | 'cellPhone'
  | 'workPhone'
  | 'email';

export type ColumnRoles = Partial<Record<FieldRole, string>>;

export type ColumnGroup = 'house' | 'parcel' | 'person';

/** One row as read from a file, before Terrain gives it an identity. */
export interface IncomingRow {
  /** Position in the file: layer order, then row order. */
  sourceIndex: number;
  layer: string;
  /** The parcel ID cell. It can list several IDs. */
  parcelIdRaw: string;
  /** Every column, as imported. */
  fields: Record<string, string>;
  position: LatLng | null;
  /** The KML <address> My Maps writes instead of coordinates for pins it placed from an address. */
  addressText: string | null;
  /** '#RRGGBB' of the My Maps pin, when the file has pins. */
  pinColor: string | null;
}

/** Lines, polygons and My Maps directions: drawn as a muted overlay, never rows. */
export interface ReferenceFeature {
  layer: string;
  name: string;
  kind: 'line' | 'polygon' | 'point';
  /** A line is one ring; a polygon's outer ring comes first; a point is one position. */
  rings: LatLng[][];
}

export interface ParsedFile {
  fileName: string;
  format: 'kml' | 'tabular';
  columns: string[];
  layers: string[];
  rows: IncomingRow[];
  reference: ReferenceFeature[];
  /** Roles recognized from the headers; the column mapping screen fills the gaps. */
  roles: ColumnRoles;
}

/** Row cells local events write. Notes are not one: Terrain's notes are events, kept apart from the imported cell. */
export type AppField = 'status' | Exclude<AppRole, 'notes'>;

/** What local work a re-import must not overwrite. */
export interface LocalTouches {
  /** App-owned fields changed by a local event (a status tap, a call), sorted. */
  appFields: AppField[];
  /** The house was moved with "Use my location". */
  moved: boolean;
}

/** One row of the client's file: one owner on one parcel ID. */
export interface Row {
  rowId: string;
  campaignId: string;
  /** Export order. */
  rowIndex: number;
  layer: string;
  parcelIdRaw: string;
  /** IDs in the parcel ID cell that Alex marked as old (crossed out in the client's file). */
  oldParcelIds: string[];
  lotKeys: string[];
  houseKey: string;
  fingerprint: string;
  /** Imported values, from the latest import. */
  sourceFields: Record<string, string>;
  /** Local corrections, by column. */
  edits: Record<string, string>;
  importedPosition: LatLng | null;
  position: LatLng | null;
  addressText: string | null;
  pinColor: string | null;
  statusId: string;
  /** The status the latest import gave this row (its pin color): where local events start from. */
  importedStatusId: string;
  packageStatusText: string;
  visitDate: string;
  callDate: string;
  callResult: string;
  importedNotes: string;
  origin: { eventId: string; fromHouseKey: string } | null;
  touched: LocalTouches;
  missingFromLastImport: boolean;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  createdAt: string;
  sourceFiles: string[];
  columnOrder: string[];
  columnGroups: Record<string, ColumnGroup>;
  roles: ColumnRoles;
  /** The column lots are grouped by; null means the parcel ID. */
  lotColumn: string | null;
  /** My Maps pin color '#RRGGBB' → status id. */
  colorMap: Record<string, string>;
  layers: string[];
  /** [west, south, east, north] of the rows with a position. */
  bounds: [number, number, number, number] | null;
  reference: ReferenceFeature[];
}

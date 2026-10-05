/** Screens a reload would lose: an import on its way in, a restore waiting for its yes. */
const BUSY_SCREENS: ReadonlySet<string> = new Set([
  'reading',
  'mapping',
  'colors',
  'report',
  'restore',
]);

/** What is open on the phone when a new version is ready. */
export interface WorkInProgress {
  screen: string;
  sheetOpen: boolean;
  panelOpen: boolean;
  editingStatus: boolean;
  exporting: boolean;
  /** A call dialed in the last 30 minutes still waits for its outcome (§5.5). */
  callWaiting: boolean;
}

/**
 * Whether "Update ready" may show (§8, prompt mode): only when no sheet, panel or edit is open, no
 * import or export is under way and no call waits, so Reload never interrupts work.
 */
export function mayOfferUpdate(work: WorkInProgress): boolean {
  return !(
    work.sheetOpen ||
    work.panelOpen ||
    work.editingStatus ||
    work.exporting ||
    work.callWaiting ||
    BUSY_SCREENS.has(work.screen)
  );
}

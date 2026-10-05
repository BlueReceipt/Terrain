import { reloadToUpdate, updateReady } from '../pwa.ts';
import { freshPendingCall } from './actions.ts';
import { exporting } from './exports.ts';
import { screen } from './flow.ts';
import { panel, sheet } from './mapState.ts';
import { editingStatus } from './settingsActions.ts';
import { strings } from './strings.ts';
import { mayOfferUpdate } from './updateGate.ts';

/** Update ready (prompt mode), held back while work is open (`mayOfferUpdate`). */
export function UpdateBar() {
  const free = mayOfferUpdate({
    screen: screen.value.name,
    sheetOpen: sheet.value !== null,
    panelOpen: panel.value !== null,
    editingStatus: editingStatus.value !== null,
    exporting: exporting.value,
    callWaiting: freshPendingCall() !== null,
  });
  if (!updateReady.value || !free) return null;
  return (
    <div class="update-bar" role="status">
      <span>{strings.update.ready}</span>
      <button type="button" class="button primary" onClick={reloadToUpdate}>
        {strings.update.reload}
      </button>
    </div>
  );
}

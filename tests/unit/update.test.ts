import { describe, expect, it } from 'vitest';
import { mayOfferUpdate, type WorkInProgress } from '../../src/ui/updateGate.ts';

const idle: WorkInProgress = {
  screen: 'campaign',
  sheetOpen: false,
  panelOpen: false,
  editingStatus: false,
  exporting: false,
  callWaiting: false,
};

describe('the update prompt (§8)', () => {
  it('shows when nothing is open, on the map, at home or in Settings', () => {
    for (const screen of ['campaign', 'home', 'settings', 'failed'])
      expect(mayOfferUpdate({ ...idle, screen })).toBe(true);
  });

  it('waits while a sheet, panel or edit is open, an export runs or a call waits', () => {
    for (const busy of [
      'sheetOpen',
      'panelOpen',
      'editingStatus',
      'exporting',
      'callWaiting',
    ] as const)
      expect(mayOfferUpdate({ ...idle, [busy]: true }), busy).toBe(false);
  });

  it('waits during an import and before a restore is confirmed', () => {
    for (const screen of ['reading', 'mapping', 'colors', 'report', 'restore'])
      expect(mayOfferUpdate({ ...idle, screen }), screen).toBe(false);
  });
});

import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';

/** True when a new version is downloaded and waiting (prompt mode). */
export const updateReady = signal(false);

let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;

export function startServiceWorker(): void {
  applyUpdate = registerSW({
    onNeedRefresh() {
      updateReady.value = true;
    },
  });
}

export function reloadToUpdate(): void {
  void applyUpdate?.(true);
}

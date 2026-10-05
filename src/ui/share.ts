import { saveFile } from '../data/files.ts';

export type Delivery = 'shared' | 'saved' | 'cancelled';

/**
 * Hands files to the phone's share sheet where the browser can share them (Web Share with files),
 * otherwise to Downloads. Chrome shares only some file types; the others are saved.
 */
export async function deliver(files: File[]): Promise<Delivery> {
  if ('canShare' in navigator && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (error) {
      // Closing the share sheet is a choice; anything else falls back to Downloads.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  for (const file of files) saveFile(file.name, file, file.type);
  return 'saved';
}

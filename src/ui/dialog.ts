import { useEffect, useRef } from 'preact/hooks';

/**
 * A sheet or panel over the screen (§9, WCAG): it takes the focus when it opens (its own field if
 * it focuses one, else its title), Escape closes it, and the focus goes back where it was.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      (root.querySelector<HTMLElement>('h2') ?? root).focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (before?.isConnected) before.focus();
    };
  }, []);
  return ref;
}

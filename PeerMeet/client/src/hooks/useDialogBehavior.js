import { useEffect, useRef } from 'react';

/**
 * Standard dialog behaviour for a modal: Escape closes it, focus moves into it when it opens and goes back
 * to where it was when it closes. Returns a ref to put on the element that should receive the focus.
 */
export function useDialogBehavior(onClose) {
  const focusRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    focusRef.current?.focus?.();
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  return focusRef;
}

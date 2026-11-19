import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Guards a sheet/form against losing unsaved edits.
 *
 * `requestClose()` closes straight away when the form is clean; when it's dirty it
 * raises `confirming` instead, so the sheet can show a Save / Discard prompt.
 * While dirty it also arms the browser's own "leave site?" warning, which covers
 * reloads (incl. pull-to-refresh) and closing the tab on browsers that honour it.
 */
export function useDirtyGuard(dirty: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const requestClose = useCallback(() => {
    if (dirtyRef.current) setConfirming(true);
    else onClose();
  }, [onClose]);

  const cancel = useCallback(() => setConfirming(false), []);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Escape closes the prompt first, then (on a second press) behaves like any close.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (confirming) setConfirming(false);
      else requestClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirming, requestClose]);

  return { confirming, requestClose, cancel };
}

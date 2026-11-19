import { useEffect, type RefObject } from 'react';

const DISMISS_PX = 90;

/**
 * Pull-down-to-dismiss for a bottom sheet. Only engages when the sheet is scrolled to
 * the top and the touch didn't start in a text field, so it never fights scrolling
 * or text selection. Calls `onDismiss` past the threshold and springs back either
 * way — `onDismiss` decides whether the sheet actually closes (e.g. a dirty guard).
 */
export function useSwipeDown(ref: RefObject<HTMLElement | null>, onDismiss: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY = 0;
    let dy = 0;
    let tracking = false;
    let dragging = false;

    function reset() {
      if (!el) return;
      el.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
      el.style.transform = '';
    }

    function onStart(e: TouchEvent) {
      const target = e.target as HTMLElement;
      tracking = el!.scrollTop <= 0 && !target.closest('textarea, input, select, [contenteditable="true"]');
      dragging = false;
      dy = 0;
      startY = e.touches[0].clientY;
    }

    function onMove(e: TouchEvent) {
      if (!tracking) return;
      dy = e.touches[0].clientY - startY;
      if (!dragging) {
        if (dy < 6) {
          if (dy < 0) tracking = false; // scrolling up — let the sheet scroll
          return;
        }
        dragging = true;
        el!.style.transition = 'none';
      }
      e.preventDefault(); // stop the page's pull-to-refresh while dragging the sheet
      el!.style.transform = `translateY(${Math.max(0, dy - 6)}px)`;
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      tracking = false;
      reset();
      if (dy > DISMISS_PX) onDismiss();
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref, onDismiss]);
}

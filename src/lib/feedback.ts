// Small tactile/visual feedback helpers shared by rows, lists and the store.

/** A short haptic tap. Android only: iOS PWAs have no haptics API, so this is a no-op there. */
export function haptic(ms = 15): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Some browsers throw if vibrate is called without a user gesture.
  }
}

/** True when the user asked the OS to minimise motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

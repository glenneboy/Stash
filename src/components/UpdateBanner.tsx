import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Registers the service worker and shows "New version available · Refresh"
 * once a new deploy has downloaded. The service worker only checks for a new
 * version on load by default, and an installed PWA resumed from the background
 * never reloads — so also check whenever the app comes back to the foreground,
 * and hourly while it stays open.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;
      const check = async () => {
        if (registration.installing || !navigator.onLine) return;
        // Skip quietly if offline or the fetch fails; the next check retries.
        try {
          const res = await fetch(swUrl, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
          if (res.ok) await registration.update();
        } catch {
          /* ignore */
        }
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check();
      });
      setInterval(check, CHECK_EVERY_MS);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex items-center gap-4 rounded-xl border border-line bg-elevated px-4 py-3 shadow-lg">
        <span className="text-sm">New version available</span>
        {/* Reloads into the new version; an open sheet with unsaved edits arms
            the browser's "leave page?" prompt (useDirtyGuard) before that happens. */}
        <button onClick={() => void updateServiceWorker(true)} className="text-sm font-medium text-accent">
          Refresh
        </button>
        <button onClick={() => setNeedRefresh(false)} aria-label="Dismiss" className="text-muted">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback (parity with the previous generateSW navigateFallback).
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// A new version waits instead of taking over straight away; the page shows a
// "New version available · Refresh" banner and sends SKIP_WAITING when tapped.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

interface PushPayload {
  title?: string;
  body?: string;
  taskId?: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = {};
  }
  const taskId = data.taskId;
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Stash', {
      body: data.body ?? '',
      icon: '/Stash/pwa-192.png',
      badge: '/Stash/pwa-192.png',
      tag: taskId ? `task-${taskId}` : undefined,
      data: { taskId },
      // Action buttons (Android, desktop Chrome/Edge; iOS ignores them). Not in
      // TS's NotificationOptions yet, hence the cast.
      ...(taskId
        ? {
            actions: [
              { action: 'done', title: 'Done' },
              { action: 'snooze', title: 'Snooze 1h' },
              { action: 'tomorrow', title: 'Tomorrow' },
            ],
          }
        : {}),
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const taskId = (event.notification.data as { taskId?: string } | undefined)?.taskId;
  // A tapped action button travels to the app as `&do=<action>`; the app applies it
  // (it holds the signed-in session) instead of opening the task.
  const action = ['done', 'snooze', 'tomorrow'].includes(event.action) ? event.action : '';
  const url = taskId ? `/Stash/?task=${taskId}${action ? `&do=${action}` : ''}` : '/Stash/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes('/Stash/'));
      if (existing) {
        return existing.navigate(url).then((c) => (c ?? existing).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});

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

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
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
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const taskId = (event.notification.data as { taskId?: string } | undefined)?.taskId;
  const url = taskId ? `/Stash/?task=${taskId}` : '/Stash/';
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

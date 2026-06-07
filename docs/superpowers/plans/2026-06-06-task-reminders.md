# Task Reminders (Scheduled Web Push) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user set a one-off date+time reminder on a task and receive a Web Push notification (with escalating nudges while incomplete) on all their devices, even when the app is closed.

**Architecture:** A new `reminder_at` plus internal scheduling fields (`notify_next_at`, `notify_stage`) on `tasks`, and a `push_subscriptions` table. A custom service worker (via vite-plugin-pwa `injectManifest`) handles `push`/`notificationclick`. A Supabase Edge Function (`send-reminders`) is called every minute by `pg_cron`; it finds due tasks, sends VAPID-signed Web Push to each of the user's subscriptions, prunes dead ones, and advances the nudge schedule. Tap-to-open deep-links into the app via `?task=<id>`.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind (client); Supabase Postgres/RLS/Auth + Edge Functions (Deno) + `pg_cron`/`pg_net`; `web-push` (server-side only) for VAPID signing; workbox-precaching/-routing (already installed) for the SW.

**Nudge schedule (canonical):** stage offsets from `reminder_at` — stage 0 `+0`, stage 1 `+1h`, stage 2 `+1d`, stage 3 `+4d`, stage 4 `+11d`, then give up. Completing or removing the reminder cancels all remaining stages.

---

## Testing Note (project reality)

This repo has **no test runner** and an explicit "no new dependencies without asking" rule. Adding vitest/jest is out of scope. Per `BRIEF.md`, the Definition of Done gate is **`npx tsc --noEmit` + `npm run build` pass**, plus **manual end-to-end verification** of the push flow (which is inherently a device/network behaviour, not unit-testable). Each task below therefore verifies with the type/build gate and a concrete manual check, then commits.

## File Structure

**Create:**
- `supabase/migrations/20260606_task_reminders.sql` — incremental migration for the live DB.
- `supabase/functions/send-reminders/index.ts` — the cron-invoked Edge Function.
- `src/sw.ts` — custom service worker (precache + push + notificationclick).
- `src/lib/push.ts` — client push-permission/subscription helpers.
- `src/lib/reminders.ts` — small shared helpers (status + datetime-local conversion).

**Modify:**
- `supabase/schema.sql` — source-of-truth schema: new columns, `push_subscriptions`, index, RLS.
- `src/types.ts` — add reminder fields to `Task`.
- `src/lib/store.ts` — reminder mutations; cancel schedule on complete; defaults on create.
- `vite.config.ts` — switch PWA to `injectManifest`.
- `src/components/EditSheet.tsx` — datetime picker + permission/subscribe + save/clear reminder.
- `src/components/TaskItem.tsx` — subtle bell badge.
- `src/components/Home.tsx` — `?task=<id>` deep-link opens the EditSheet.
- `.env.example` — document `VITE_VAPID_PUBLIC_KEY`.

---

### Task 1: Database schema — reminder fields + push_subscriptions

**Files:**
- Modify: `supabase/schema.sql`
- Create: `supabase/migrations/20260606_task_reminders.sql`

- [ ] **Step 1: Add columns + table + RLS to the source-of-truth schema**

Append to `supabase/schema.sql` (after the existing `tasks` index block, before Row-Level Security — keep RLS edits with the other policies):

```sql
-- ── Reminders (scheduled web push) ──────────────────────────
-- reminder_at  : user-set instant the task first notifies (absolute UTC).
-- notify_next_at: next instant the cron should fire (null = nothing pending).
-- notify_stage : index of the next stage to fire (0=on-time,1..4=nudges).
alter table public.tasks add column if not exists reminder_at   timestamptz;
alter table public.tasks add column if not exists notify_next_at timestamptz;
alter table public.tasks add column if not exists notify_stage  int not null default 0;

create index if not exists tasks_notify_next_at_idx
  on public.tasks (notify_next_at) where notify_next_at is not null;

-- ── Push subscriptions (one row per device/browser) ─────────
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
```

In the Row-Level Security section of `supabase/schema.sql`, add alongside the existing policies:

```sql
alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Create the incremental migration file**

Create `supabase/migrations/20260606_task_reminders.sql` with the exact same statements as Step 1 (columns, index, table, index, RLS enable + policy), so the live DB can be migrated without re-running the whole schema.

- [ ] **Step 3: Apply to the database and verify**

Run (Supabase SQL editor, or CLI against the project):
```bash
# Option A: paste supabase/migrations/20260606_task_reminders.sql into the SQL editor and run.
# Option B (CLI, if linked):
supabase db push
```
Expected: no errors. Verify columns and table exist:
```sql
select column_name from information_schema.columns
 where table_name='tasks' and column_name in ('reminder_at','notify_next_at','notify_stage');
select to_regclass('public.push_subscriptions');
```
Expected: three rows returned; `push_subscriptions` is non-null.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql supabase/migrations/20260606_task_reminders.sql
git commit -m "feat: reminder fields + push_subscriptions schema"
```

---

### Task 2: Types + store mutations

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/store.ts:310-347` (createTask, updateTask area, toggleComplete)

- [ ] **Step 1: Extend the `Task` type**

In `src/types.ts`, add the three fields to `Task`:

```ts
export interface Task {
  id: string;
  title: string;
  note: string | null;
  contexts: string[];
  completed: boolean;
  created_at: string;
  completed_at: string | null;
  reminder_at: string | null;
  notify_next_at: string | null;
  notify_stage: number;
}
```

- [ ] **Step 2: Default the new fields on create**

In `src/lib/store.ts`, in `createTask`, extend the `row` object:

```ts
  const row: Task = {
    id: crypto.randomUUID(),
    title: title.trim(),
    note: note?.trim() || null,
    contexts,
    completed: false,
    created_at: new Date().toISOString(),
    completed_at: null,
    reminder_at: null,
    notify_next_at: null,
    notify_stage: 0,
  };
```

- [ ] **Step 3: Cancel the schedule when completing**

In `src/lib/store.ts`, update `toggleComplete` so completing also clears the pending notification (cron already filters `completed=false`; this makes it explicit and immediate):

```ts
export function toggleComplete(id: string): void {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const completed = !task.completed;
  const completed_at = completed ? new Date().toISOString() : null;
  const patch: Partial<Task> = { completed, completed_at };
  if (completed) patch.notify_next_at = null;
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });
  if (completed) {
    navigator.vibrate?.(15);
    showToast('Completed', () => toggleComplete(id));
  }
}
```

- [ ] **Step 4: Add reminder mutations**

In `src/lib/store.ts`, after `updateTask`, add:

```ts
// Set/replace a one-off reminder. Resets the nudge schedule to stage 0 at the new time.
export function setReminder(id: string, reminderAt: string): void {
  const patch: Partial<Task> = { reminder_at: reminderAt, notify_next_at: reminderAt, notify_stage: 0 };
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });
}

// Remove a reminder and cancel any pending nudges.
export function clearReminder(id: string): void {
  const patch: Partial<Task> = { reminder_at: null, notify_next_at: null, notify_stage: 0 };
  setTasks(state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  enqueue({ kind: 'task.update', id, patch });
}
```

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The `task.update` Op already accepts `Partial<Task>`, so the new patch fields are valid.

```bash
git add src/types.ts src/lib/store.ts
git commit -m "feat: task reminder fields and store mutations"
```

---

### Task 3: Custom service worker + injectManifest

**Files:**
- Create: `src/sw.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the service worker**

Create `src/sw.ts`:

```ts
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

self.skipWaiting();
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
      for (const client of clients) {
        if ('focus' in client) {
          void client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
```

- [ ] **Step 2: Switch vite-plugin-pwa to injectManifest**

Replace the `VitePWA({ ... })` call in `vite.config.ts` with (manifest block unchanged from current file):

```ts
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Stash',
        short_name: 'Stash',
        description: 'Frictionless, context-aware task capture.',
        theme_color: '#0F0F0F',
        background_color: '#0F0F0F',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/Stash/',
        share_target: {
          action: '/Stash/',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
```

- [ ] **Step 3: Build and verify the SW is emitted with handlers**

Run: `npm run build`
Expected: PASS. Then confirm the built SW exists and contains the push handler:
```bash
ls dist/sw.js && grep -c "addEventListener('push'" dist/sw.js
```
Expected: `dist/sw.js` exists; grep count `1`.

> If `tsc` errors on `workbox-routing` types, confirm it's installed: `ls node_modules/workbox-routing` (it is a dependency of workbox-precaching). If genuinely missing, STOP and ask before adding it.

- [ ] **Step 4: Commit**

```bash
git add src/sw.ts vite.config.ts
git commit -m "feat: custom service worker via injectManifest with push handlers"
```

---

### Task 4: Client push subscription helper

**Files:**
- Create: `src/lib/push.ts`
- Modify: `.env.example`

- [ ] **Step 1: Document the public VAPID env var**

Append to `.env.example`:

```
# Web Push public VAPID key (safe to expose). Generate with: npx web-push generate-vapid-keys
VITE_VAPID_PUBLIC_KEY=your-vapid-public-key
```

- [ ] **Step 2: Write the push helper**

Create `src/lib/push.ts`:

```ts
import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushResult = 'granted' | 'denied' | 'unsupported';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Request notification permission (if needed), subscribe this device to push,
// and persist the subscription. Safe to call repeatedly — reuses any existing sub.
export async function ensurePushSubscription(): Promise<PushResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) {
    return 'unsupported';
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await saveSubscription(sub);
  return 'granted';
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) return;
  const { data } = await supabase.auth.getUser();
  const user_id = data.user?.id;
  if (!user_id) return;
  await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id, endpoint: sub.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: 'endpoint' },
    );
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/lib/push.ts .env.example
git commit -m "feat: client web-push subscription helper"
```

---

### Task 5: Reminder helpers + EditSheet UI

**Files:**
- Create: `src/lib/reminders.ts`
- Modify: `src/components/EditSheet.tsx`

- [ ] **Step 1: Write the shared reminder helpers**

Create `src/lib/reminders.ts`:

```ts
import type { Task } from '../types';

// A task with an active (uncompleted) reminder.
export function hasReminder(task: Task): boolean {
  return task.reminder_at !== null && !task.completed;
}

// Reminder time has passed and the task is still open.
export function isOverdue(task: Task): boolean {
  return hasReminder(task) && new Date(task.reminder_at as string).getTime() <= Date.now();
}

// ISO (UTC) → value for <input type="datetime-local"> in the user's local time.
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local value (local wall-clock) → absolute ISO (UTC) instant.
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
```

- [ ] **Step 2: Wire the reminder UI into EditSheet**

Edit `src/components/EditSheet.tsx`. Update imports:

```ts
import { useState } from 'react';
import type { Context, Task } from '../types';
import { updateTask, deleteTask, setReminder, clearReminder } from '../lib/store';
import { ensurePushSubscription } from '../lib/push';
import { toLocalInput, fromLocalInput } from '../lib/reminders';
```

Add state inside the component (after the `tags` state):

```ts
  const [reminder, setReminderInput] = useState(toLocalInput(task.reminder_at));
  const [notifyWarn, setNotifyWarn] = useState(false);
```

Replace the existing synchronous `save` with an async version that handles the reminder diff:

```ts
  async function save() {
    if (!title.trim()) return;
    updateTask(task.id, { title: title.trim(), note: note.trim() || null, contexts: tags });

    const nextIso = reminder ? fromLocalInput(reminder) : null;
    if (nextIso !== task.reminder_at) {
      if (nextIso) {
        setReminder(task.id, nextIso);
        const result = await ensurePushSubscription();
        if (result !== 'granted' && !notifyWarn) {
          setNotifyWarn(true);
          return; // keep sheet open so the warning is seen; a second Save closes it
        }
      } else {
        clearReminder(task.id);
      }
    }
    onClose();
  }
```

Add the reminder field to the JSX, immediately after the contexts block (after the closing `)}` of the `contexts.length > 0` block, before the `mt-5` actions row):

```tsx
        <div className="mt-3">
          <label className="mb-1 block text-xs text-muted">Remind me</label>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={reminder}
              onChange={(e) => setReminderInput(e.target.value)}
              className="flex-1 rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent"
            />
            {reminder && (
              <button
                onClick={() => setReminderInput('')}
                aria-label="Clear reminder"
                className="rounded-xl border border-line px-3 py-3 text-sm text-muted"
              >
                Clear
              </button>
            )}
          </div>
          {notifyWarn && (
            <p className="mt-1.5 text-xs text-amber-400">
              Notifications are off — reminder saved, but it won’t alert until you allow notifications in your browser.
            </p>
          )}
        </div>
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: PASS.

Manual check (dev): `npm run dev`, open a task, set a datetime, Save. First save triggers the browser permission prompt. Allowing it stores a row — verify in Supabase:
```sql
select endpoint from public.push_subscriptions order by created_at desc limit 1;
```
Expected: one row for your device. Re-open the task → the datetime is preserved; Clear + Save removes it (`reminder_at` null in DB).

- [ ] **Step 4: Commit**

```bash
git add src/lib/reminders.ts src/components/EditSheet.tsx
git commit -m "feat: set/clear task reminders from the edit sheet"
```

---

### Task 6: Subtle bell badge on TaskItem

**Files:**
- Modify: `src/components/TaskItem.tsx`

- [ ] **Step 1: Import the reminder helpers**

Add to the imports at the top of `src/components/TaskItem.tsx`:

```ts
import { hasReminder, isOverdue } from '../lib/reminders';
```

- [ ] **Step 2: Render the bell in the title row**

In the title `<button>`, replace the title paragraph line:

```tsx
          <p className={`break-words ${task.completed ? 'text-muted line-through' : ''}`}>{task.title}</p>
```

with a title row that appends a small bell when a reminder is pending (subtle: muted normally, accent when overdue):

```tsx
          <p className={`flex items-center gap-1.5 break-words ${task.completed ? 'text-muted line-through' : ''}`}>
            <span className="min-w-0">{task.title}</span>
            {hasReminder(task) && (
              <svg
                viewBox="0 0 24 24"
                aria-label="Reminder set"
                className={`h-3.5 w-3.5 shrink-0 ${isOverdue(task) ? 'text-accent' : 'text-muted'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13.7 21a2 2 0 01-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </p>
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: PASS.

Manual check: a task with a future reminder shows a faint (muted) bell next to its title; once its time has passed (and it's still open) the bell turns accent-coloured. Completed tasks show no bell.

- [ ] **Step 4: Commit**

```bash
git add src/components/TaskItem.tsx
git commit -m "feat: subtle reminder bell on task items"
```

---

### Task 7: Notification tap deep-link

**Files:**
- Modify: `src/components/Home.tsx:53-79` (state + effects)

- [ ] **Step 1: Open the EditSheet from `?task=<id>`**

In `src/components/Home.tsx`, add an effect right after the existing `?add=` quick-capture effect (the one ending `}, [loaded, contexts]);`). It mirrors that pattern — fires once after load, then cleans the URL:

```tsx
  // Notification deep-link: `?task=<id>` opens that task's edit sheet once loaded.
  const taskLinkHandled = useRef(false);
  useEffect(() => {
    if (taskLinkHandled.current || !loaded) return;
    const id = new URLSearchParams(window.location.search).get('task');
    taskLinkHandled.current = true;
    if (!id) return;
    window.history.replaceState({}, '', window.location.pathname);
    const t = tasks.find((x) => x.id === id);
    if (t) setEditing(t);
  }, [loaded, tasks]);
```

(`useRef`, `useEffect`, `useState` for `editing`, and `tasks` are all already imported/declared in this file.)

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: PASS.

Manual check: visit `http://localhost:5173/Stash/?task=<an existing task id>` in dev → the app loads and the EditSheet for that task opens; the URL is cleaned to `/Stash/`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Home.tsx
git commit -m "feat: open task edit sheet from notification deep-link"
```

---

### Task 8: Edge Function — send-reminders

**Files:**
- Create: `supabase/functions/send-reminders/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/send-reminders/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// Stage offsets from reminder_at (ms): 0=on-time, then +1h, +1d, +4d, +11d.
const STAGE_OFFSETS_MS = [0, 3_600_000, 86_400_000, 4 * 86_400_000, 11 * 86_400_000];

const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:gmdale@yahoo.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface DueTask {
  id: string;
  user_id: string;
  title: string;
  reminder_at: string;
  notify_stage: number;
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  const nowIso = new Date().toISOString();
  const { data: due, error } = await admin
    .from('tasks')
    .select('id, user_id, title, reminder_at, notify_stage')
    .eq('completed', false)
    .not('notify_next_at', 'is', null)
    .lte('notify_next_at', nowIso)
    .returns<DueTask[]>();
  if (error) return new Response(error.message, { status: 500 });
  if (!due || due.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  const userIds = [...new Set(due.map((t) => t.user_id))];
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)
    .returns<(SubRow & { user_id: string })[]>();

  const subsByUser = new Map<string, SubRow[]>();
  for (const s of subs ?? []) {
    const list = subsByUser.get(s.user_id) ?? [];
    list.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
    subsByUser.set(s.user_id, list);
  }

  let sent = 0;
  for (const task of due) {
    const payload = JSON.stringify({ title: 'Reminder', body: task.title, taskId: task.id });
    for (const sub of subsByUser.get(task.user_id) ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }

    // Advance to the next stage, or stop (notify_next_at = null) when exhausted.
    const next = task.notify_stage + 1;
    const patch =
      next < STAGE_OFFSETS_MS.length
        ? {
            notify_stage: next,
            notify_next_at: new Date(
              new Date(task.reminder_at).getTime() + STAGE_OFFSETS_MS[next],
            ).toISOString(),
          }
        : { notify_stage: next, notify_next_at: null };
    await admin.from('tasks').update(patch).eq('id', task.id);
  }

  return new Response(JSON.stringify({ sent, due: due.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Type/lint check (Deno) and commit**

The function uses `npm:` specifiers (supported by Supabase Edge runtime); it isn't covered by the project's `tsc`. Sanity-check it parses if the Deno CLI is available, otherwise rely on the deploy step:
```bash
deno check supabase/functions/send-reminders/index.ts 2>/dev/null || echo "deno not installed locally — will validate at deploy"
```

```bash
git add supabase/functions/send-reminders/index.ts
git commit -m "feat: send-reminders edge function"
```

---

### Task 9: Deploy, wire cron, end-to-end verification

**Files:** none (infra/config). This task is operational; perform with the user.

- [ ] **Step 1: Generate VAPID keys**

Run:
```bash
npx web-push generate-vapid-keys
```
Record the **Public** and **Private** keys.

- [ ] **Step 2: Set client + function secrets**

Add the public key to `.env.local`:
```
VITE_VAPID_PUBLIC_KEY=<public key>
```
Set Edge Function secrets (choose a strong random `CRON_SECRET`):
```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:gmdale@yahoo.com \
  CRON_SECRET=<random secret>
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into Edge Functions — do not set them.)

- [ ] **Step 3: Deploy the function (cron must call it without a user JWT)**

```bash
supabase functions deploy send-reminders --no-verify-jwt
```
Auth is enforced by our own `x-cron-secret` check, not the platform JWT. Verify the secret gate:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://<PROJECT-REF>.supabase.co/functions/v1/send-reminders"
```
Expected: `401` (no secret header). With the header it returns 200:
```bash
curl -s -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/send-reminders" \
  -H "x-cron-secret: <random secret>"
```
Expected: `{"sent":0}` (nothing due yet).

- [ ] **Step 4: Schedule the cron job**

In the Supabase SQL editor:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<random secret>'),
    body    := '{}'::jsonb
  );
  $$
);
```
Verify it registered:
```sql
select jobname, schedule, active from cron.job where jobname = 'send-reminders';
```
Expected: one active row, schedule `* * * * *`.

> Hardening note (optional, not MVP-blocking): the secret is stored in the cron job definition (DB-only, never client-exposed). For defence-in-depth, move it to Supabase Vault and read it via `vault.decrypted_secrets` in the cron body.

- [ ] **Step 5: End-to-end verification**

1. Rebuild/redeploy the client with `VITE_VAPID_PUBLIC_KEY` set (`npm run build` + deploy).
2. On an **installed** PWA (Android/desktop), set a reminder ~2 minutes out and allow notifications.
3. Close the app entirely.
4. At the reminder time (within the next cron minute) the device shows a notification titled "Reminder" with the task title.
5. Tap it → the app opens with that task's edit sheet.
6. Leave the task incomplete → confirm a nudge arrives ~1 hour later (or temporarily shorten `STAGE_OFFSETS_MS[1]` to test faster, then revert).
7. Complete the task before a nudge → confirm no further notifications (verify `notify_next_at` is null in the DB).
8. Confirm a second device that allowed notifications also received the push.

Expected: all of the above behave as described; `BRIEF.md` Definition of Done is satisfied.

- [ ] **Step 6: Final gate + commit any config**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

```bash
git add .env.example
git commit -m "chore: document VAPID public key env"
```

---

## Self-Review

**Spec coverage (BRIEF.md → tasks):**
- `reminder_at` settable/clearable via EditSheet (native datetime) → Task 5. ✅
- First reminder triggers permission prompt; grant stores subscription → Tasks 4, 5. ✅
- Permission-denied saves reminder but warns → Task 5 (`notifyWarn`). ✅
- On-time notification with app closed; tap opens that task → Tasks 3, 7, 8, 9. ✅
- Escalating nudges (+1h,+1d,+4d,+11d) stop on completion/removal → Tasks 2 (cancel), 8 (advance). ✅
- Changing a reminder cancels old, starts new → Task 2 (`setReminder` resets stage/next). ✅
- Fan-out to all devices; prune invalid subscriptions → Task 8. ✅
- Subtle bell badge → Task 6. ✅
- `pg_cron` + Edge Function deployed/verified → Task 9. ✅
- Security controls 1–4 (secrets out of client/git, RLS, authenticated cron, pruning) → Tasks 1 (RLS), 8 (prune), 9 (secrets + `x-cron-secret`). ✅
- `tsc && vite build` pass; offline behaviour intact after SW migration → Tasks 3, 9 (NavigationRoute fallback). ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step contains full code; the only `<PROJECT-REF>`/`<...key>` placeholders are real per-deployment secrets in Task 9, which must not be committed.

**Type consistency:** `Task` fields `reminder_at`/`notify_next_at`/`notify_stage` are defined in Task 2 and used identically in Tasks 5, 6, 8. `ensurePushSubscription(): PushResult` (Task 4) matches its `await` use in Task 5. `setReminder`/`clearReminder` signatures (Task 2) match their calls (Task 5). `STAGE_OFFSETS_MS` length-based exhaustion (Task 8) matches the stage 0–4 schedule in the header. Payload `{ title, body, taskId }` written in Task 8 matches the `PushPayload` read in Task 3.

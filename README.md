# Stash

A lightweight, mobile-first PWA for frictionless, context-aware task capture. Capture now, sort never.

Built with React 18 + Vite 5, Tailwind CSS 3, Supabase (Auth, Postgres, Realtime), and the Vite PWA plugin.

---

## Features

### Capture

- **Always-visible capture bar** — single input always at the top of the screen; works with the phone keyboard's voice-to-text.
- **Inline `#tag` parsing** — type `#Work buy milk` and the task is created titled "buy milk" tagged Work, matching case-insensitively against existing contexts. Unrecognised hashtags stay in the title.
- **Note field** — optional multi-line note attached to any task; revealed in the capture bar when pre-filled (e.g. via Share).
- **Context pre-seeding** — new tasks are automatically pre-tagged with whichever contexts are currently active in the filter, so you never have to re-select.

### Contexts (Tags)

Contexts are user-defined labels that group tasks. A task can carry zero or more contexts.

- **Create / rename / delete** contexts via the manage sheet (the `…` button in the filter bar).
- **Deleting a context** strips it from every task that referenced it (cascading removal).
- **Untagged tasks** (`contexts: []`) appear in **every** context view, not just "All".

### Context Filtering

- **Quick tap** a context chip → **transient** filter (at most one; clears when you pick another).
- **Long-press** (500 ms) a context chip → **sticky** filter (multiple allowed; marked with a dot).
- **Intersection logic** — when multiple contexts are selected a task must carry *all* of them to appear.
- **Clear button** resets all filters at once.
- Sticky filters survive transient changes and must be explicitly cleared.

### Task Editing

Tap any task to open the edit sheet:

| Field | Notes |
|---|---|
| Title | Editable text input |
| Note | Optional multi-line text |
| Contexts | Toggleable pills — multi-select |
| Due date | Native date picker; "Clear" button when set |
| Reminder | Native datetime picker; triggers web push when the time arrives |
| Complete | Checkbox at top-left; saves edits and marks done in one tap |
| Delete | Removes the task with an undo window |

### Completing Tasks

- **Tap the checkbox** in the task list or edit sheet.
- **Swipe right** on a task (≥80 px) → complete with green visual feedback.
- Completed tasks collapse into a togglable **Completed (N)** section below the active list.
- Completing a task cancels any outstanding push nudge.
- Haptic feedback (15 ms vibration) and a checkbox pop animation on completion.

### Deleting Tasks

- **Delete button** in the edit sheet.
- **Swipe left** on a task (≥80 px) → delete with red visual feedback.
- All deletions show an undo toast (5 s window).
- **Clear** button in the completed section bulk-removes all completed tasks (also undoable).

### Sort & Reorder

The sort control (top-right of the active list) offers:

| Mode | Behaviour |
|---|---|
| Date ↑/↓ | Sort by creation date |
| Due Date ↑/↓ | Tasks with a due date first; undated at the bottom |
| Title ↑/↓ | Alphabetical |
| Custom | Appears once you've dragged tasks into a manual order |

**Custom drag-to-reorder** — hold the six-dot grip on any task and drag. The drop position is shown as an accent-coloured line. Order is saved per-context combination in `localStorage`. Drag handles are hidden during search to prevent accidental reorders.

### Search

Toggle the search icon in the header to reveal a real-time text filter that matches against task **title and note**. Searches within the current context selection.

### Reminders & Push Notifications

- Set a reminder date/time in the edit sheet.
- On first save, the app requests notification permission and registers a push subscription.
- A server-side cron sends the push at the scheduled time.
- **Escalating nudge schedule**: on time → +1 h → +1 d → +4 d → +11 d (resets if the reminder is changed).
- Tapping a notification deep-links straight to the task (`?task=<id>`).
- The bell icon on a task turns red when a reminder is overdue.

### Profiles

- Switch between isolated **profiles** (e.g. "Work", "Home") from the selector in the header — each profile has its own completely separate set of tasks and tags.
- The default ("Personal") profile is implicit: tasks/contexts with no `profile_id` belong to it, so existing data needs no migration.
- **Manage profiles** (create / rename / delete) via the "Manage profiles…" entry in the selector; deleting a profile cascades to its tasks and tags.
- Custom drag-to-reorder order, and the active filter selection, are namespaced per profile.
- **Move a task to another profile** from its edit sheet ("Move this to…"). Its tags are re-pointed to matching tags (by name, case-insensitive) in the destination, creating any that don't exist there yet, so the task keeps every tag. Shows a "Moved to … · Undo" toast.

### Deep Links

| Parameter | Behaviour |
|---|---|
| `?add=<text>` | Headlessly creates a task; supports inline `#tags` |
| `?task=<id>` | Opens the edit sheet for that task. If the task lives in a non-active profile, the app switches to that profile first — there is currently no dedicated `?profile=<id>` link to open a profile directly, this is the only way to deep-link into one. |
| `?context=<name>` | Sticky-activates a context filter by name (case-insensitive) in the current profile; silently ignored if the context doesn't exist or has no tasks |
| `?title=&text=&url=` | PWA Share Target — content arrives pre-filled in the capture bar |

All deep-link params clean themselves from the URL after handling (`history.replaceState`).

### Offline & Sync

- The app shell is **fully cached** by the Workbox service worker; loads without a connection.
- Every write (create / update / delete) is applied **optimistically** to local state immediately.
- If offline, operations are queued in `localStorage` and flushed FIFO on reconnect.
- The header shows live status: **Offline** (amber) · **Syncing…** · **N queued**.
- **Supabase Realtime** keeps multiple devices in sync; changes from another session appear instantly.
- Incoming realtime updates are suppressed for rows that have unflushed local edits (conflict avoidance).

### Authentication

- **Email magic link** — enter your email, click the link; no password needed.
- **iOS OTP fallback** — iOS browsers are shown an 8-digit code input instead of the magic link, since iOS Safari cannot return to a PWA from an external email client.
- Session is persisted in browser storage and survives refreshes.

### PWA / Install

- Add to home screen on iOS or Android for a fullscreen standalone experience.
- `theme_color` and `background_color` are both `#0F0F0F` (dark only).
- Safe-area insets respected for notch and home-indicator devices.

---

## Setup

### 1. Create a Supabase project

Create a new project at [supabase.com](https://supabase.com).

In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql) to create the `tasks`, `contexts`, and `push_subscriptions` tables and their row-level-security policies.

Under **Authentication → Providers → Email**, ensure email is enabled (magic links work out of the box).

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill `.env.local` with your project's values from **Settings → API**:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_VAPID_PUBLIC_KEY=your-vapid-public-key   # for push notifications
```

### 3. Run

```bash
npm install
npm run dev
```

Open the dev URL, enter your email, and click the magic link to sign in.

## Build & deploy

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally
```

Deploy to **Vercel** (recommended): import the repo, add the three env vars, and deploy.

> **Auth redirect:** in Supabase **Authentication → URL Configuration**, add your deployed origin to the allowed redirect URLs so magic links return to the app.

## Install as a PWA

Open the deployed site on your phone and choose **Add to Home Screen**. The app then launches fullscreen and loads its cached shell even without a connection.

> The app icon is a generated placeholder ([`scripts/generate-icons.mjs`](scripts/generate-icons.mjs)). Replace the PNGs in `public/` with your own artwork any time.

## Project layout

```
src/
├── components/
│   ├── Auth.tsx          # magic-link + iOS OTP sign-in
│   ├── CaptureBar.tsx    # always-visible task input
│   ├── ContextManager.tsx# create / rename / delete contexts
│   ├── EditSheet.tsx     # full task editor (title, note, due, reminder, tags)
│   ├── FilterBar.tsx     # context chips (quick-tap / long-press)
│   ├── Home.tsx          # main view, deep-link handling, sort, drag-reorder
│   ├── OpenInApp.tsx     # iOS PWA redirect helper
│   ├── ProfileManager.tsx# create / rename / delete profiles
│   ├── TaskItem.tsx      # task row with swipe gestures and drag grip
│   └── Toast.tsx         # undo toasts
├── lib/
│   ├── profiles.ts       # profile filtering + cross-profile tag migration
│   ├── push.ts           # push subscription helpers
│   ├── reminders.ts      # reminder permission + subscription flow
│   ├── store.ts          # state, offline queue, Supabase sync, Realtime
│   ├── supabase.ts       # Supabase client
│   ├── tags.ts           # inline #tag parsing
│   └── useStore.ts       # useSyncExternalStore hook
├── types.ts              # Context, Task interfaces
├── App.tsx               # auth gate + iOS deep-link redirect
├── main.tsx
└── sw.ts                 # Workbox service worker (push, notification click)
supabase/schema.sql       # tables + RLS — run this in Supabase SQL editor
```

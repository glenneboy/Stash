# Stash

A lightweight, mobile-first PWA for frictionless, context-aware task capture. Capture now, sort never.

Built with React + Vite, Tailwind, Supabase (Auth + Postgres), and the Vite PWA plugin.

## Features

- **Frictionless capture** — single always-visible input; works with the phone keyboard's voice-to-text.
- **Context tags** — tag tasks with one or more contexts (IOM / Work / Home / Personal, seeded but fully editable).
- **Context filter** — `All` shows everything; a context filter shows its tasks plus untagged ones.
- **Complete & hide** — tap to tick off; completed tasks collapse into a togglable section.
- **Edit / delete** — tap a task to change its title, note, or tags, or delete it.
- **Cross-device sync** — tasks persist in Supabase, gated by row-level security (only you see your data).
- **Offline-capable** — the app shell is cached; edits made offline are queued and synced on reconnect.
- **Installable** — add to the iOS/Android home screen, or use in any desktop browser.

## Setup

### 1. Create a Supabase project

Create a new project at [supabase.com](https://supabase.com) (separate from any existing one).

In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql) to create the `tasks` and
`contexts` tables and their row-level-security policies.

Under **Authentication → Providers → Email**, ensure email is enabled (magic links work out of the box).

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill `.env.local` with your project's values from **Settings → API**:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

### 3. Run

```bash
npm install
npm run dev
```

Open the dev URL, enter your email, and click the magic link to sign in. The four default
contexts are seeded automatically on first login.

## Build & deploy

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally
```

Deploy to **Vercel** (recommended for env-var handling): import the repo, set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables, and deploy.

> **Auth redirect:** in Supabase **Authentication → URL Configuration**, add your deployed
> origin to the allowed redirect URLs so magic links return to the app.

## Install as a PWA

Open the deployed site on your phone and choose **Add to Home Screen**. The app then launches
fullscreen and loads its cached shell even without a connection.

> The app icon is a generated placeholder ([`scripts/generate-icons.mjs`](scripts/generate-icons.mjs)).
> Replace the PNGs in `public/` with your own artwork any time.

## Project layout

```
src/
├── components/   # Auth, Home, CaptureBar, FilterBar, TaskItem, EditSheet, ContextManager
├── hooks/        # useSession
├── lib/          # supabase client, store (state + offline queue), useStore
├── types.ts
├── App.tsx       # auth gate
└── main.tsx
supabase/schema.sql   # tables + RLS — run this in Supabase
```

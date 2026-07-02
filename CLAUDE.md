# CLAUDE.md — Stash

Mobile-first PWA task manager. React + TypeScript + Vite, Supabase (email OTP / magic-link auth, Postgres, Realtime sync), deployed to GitHub Pages.

## Repo & accounts
- GitHub account is **glenneboy** — never glenndale. Repo: `glenneboy/Stash`.
- Live app: https://glenneboy.github.io/Stash/

## Shipping
- "ship it" = commit → push → PR → **merge** → watch CI to green (use the `ship` skill). Don't stop at push.
- Verify with `npx tsc --noEmit` / `npm run build` before committing.

## Deploy foot-guns (each has broken production before)
- Vite `base` is `/Stash/`. Never build redirect or absolute URLs from `window.location.origin` alone — auth/magic-link redirects must keep the `/Stash/` path or they 404.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are injected at build time from repo secrets in `.github/workflows/deploy.yml`. A blank screen on Pages usually means a workflow change dropped them.

## Facts — don't re-derive these
- Quick-capture deeplink: `https://glenneboy.github.io/Stash/?add=<text> #Tag` — text becomes the task, trailing `#tag` sets the context. Used by jeebs/Raycast/Shortcuts.
- Installed PWAs (iOS/Android/Mac) pick up a Pages deploy on next launch once the service worker refreshes — no reinstall needed.
- iOS has no Web Share Target; that's why the `?add=` deeplink exists.
- The backlog lives in GitHub issues, not a backlog.md.

## Design
- Minimalist, mobile-first. Verify UI changes at a mobile viewport (~390px wide) before calling them done — desktop-only checks have shipped mobile regressions before.

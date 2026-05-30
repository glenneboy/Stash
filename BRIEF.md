# Engineering Brief — Quick-Capture Deeplink (`?add=`)

## Outcome
From a Mac launcher (jeebs / Raycast / Alfred) or an Apple Shortcut, the user types
`stash This is my task #iom`, the launcher opens a Stash URL with the text as a query string,
and Stash **creates the task immediately** — title "This is my task", tagged with the IOM
context — with no clicks. The just-added task appears at the top of the list (live via Realtime
if a window is already open) and a confirmation toast shows.

This is the desktop equivalent of the Android PWA share target, which desktop Chrome does not
support. The launcher supplies the trigger; Stash supplies the behaviour.

## Problem (root cause)
The app already ingests share params (`readShared` in `Home.tsx`) but only **prefills** the
capture bar — the user must still press Add. And `#tag → context` resolution only runs inside
`CaptureBar.submit()`. There is no URL path that creates a task headlessly.

## In Scope
- **New `?add=<text>` deeplink param** read on load in `Home.tsx`, distinct from the existing
  `?title/?text/?url` prefill path (which stays unchanged).
- **Tag resolution reuse**: lift the existing `parseTags` (`#context` → context id,
  case-insensitive, unmatched left literal) into a shared `src/lib/tags.ts`; both `CaptureBar`
  and the deeplink path use it. Behaviour identical to today.
- **Headless create**: parse the text → if a non-empty title remains, create the task via the
  existing optimistic store path. Whole text (minus matched tags) becomes the title; no note.
- **Confirmation toast**: reuse the existing toast — "Added", with **Undo** that deletes the
  just-created task (consistent with Completed/Deleted toasts).
- **URL cleanup**: strip the query after processing via `history.replaceState`, same as
  `readShared` does today.
- **Fire-once + load-gated**: process only after the store has `loaded` (so contexts exist to
  resolve `#iom`), and exactly once per page load.

## Out of Scope
- Manifest/`share_target` changes. Desktop share-sheet integration is delivered separately via
  an Apple Shortcut that opens the same `?add=` URL — no app change needed for that.
- A headless script writing directly to Supabase (the no-browser route). Different trade-off
  (key on disk); not this piece of work.
- Preserving the add across sign-in. If signed out, the add is dropped (see Edge Cases).
- Splitting title vs note, first-N-words title suggestion, or auto-creating contexts.
- Any change to the offline queue, Realtime sync, swipe/undo, or existing share-target prefill.
- New dependencies.

## Key Flows
- **Happy path**: launcher opens `…/Stash/?add=This%20is%20my%20task%20%23iom` → app loads,
  store reaches `loaded` → read `add` → `parseTags` strips `#iom` to the IOM context id and
  leaves title "This is my task" → `quickAddTask("This is my task", [iomId])` → task inserted
  optimistically (Realtime syncs other devices), URL cleaned, "Added" toast shown.
- **Multiple tags**: `?add=foo #iom #work` → both resolved and applied.
- **Unknown tag**: `?add=foo #randomword` → `#randomword` stays literal in the title; task
  titled "foo #randomword", no context. No context is created.

## Edge Cases and Error Handling
- **Empty / tag-only add** (`?add=` empty, or only resolved tags leaving no title): no-op,
  URL still cleaned, app opens normally. No empty task, no toast.
- **Signed out**: `Home` only mounts when authed, so the deeplink path never runs on the Auth
  screen; the magic-link redirect to `/Stash/` strips the query, so the add does not survive
  sign-in. Net effect: dropped, by design.
- **Contexts not yet loaded**: gated on `loaded`; processing waits so `#iom` resolves rather
  than falling through to literal text.
- **Double-fire** (re-render / effect re-run): guarded by a ref so it creates at most one task
  per page load; URL cleanup is also idempotent.
- **Undo**: tapping Undo on the "Added" toast deletes the created row through the normal
  delete path (which itself shows a "Deleted" toast — accepted, consistent with the app).

## Tech Stack
- React 18 + TypeScript, Vite, Tailwind (existing dark tokens).
- Supabase JS v2 (existing optimistic store + Realtime).
- Static PWA on GitHub Pages, base `/Stash/`. No new dependencies.

## Non-Functional Requirements
| Area | Requirement |
|---|---|
| Performance | Single optimistic insert; task visible instantly, no network wait. |
| Security | Runs only inside the authenticated session; RLS unchanged. No secrets introduced. |
| Scalability | N/A — one task per invocation. |
| Resilience | Uses the existing offline queue; an add made offline flushes later like any task. |
| Observability | N/A (personal app). Empty/invalid adds fail silently into a normal app open. |
| Compliance | Unchanged. |

## Integration Points
| Dependency | Protocol | Failure Mode |
|---|---|---|
| Launcher (jeebs/Raycast/Alfred) or Apple Shortcut | Opens an HTTPS URL with `?add=` | If URL not opened in the PWA window, opens a Chrome tab; task still created in-session. |
| Existing optimistic store (`createTask`) | In-app function call | Offline → queued and flushed later; no special handling. |

## Domain Nomenclature
| Term | Definition |
|---|---|
| Quick-capture deeplink | A `…/Stash/?add=<text>` URL that creates a task headlessly on load. |
| `add` param | The query param carrying the raw capture text (title + inline `#tags`). |
| Inline tag | A `#name` token in the text matching an existing context (case-insensitive). |
| quickAddTask | Store function: create a task from title + context ids and show an "Added" toast. |

## Open Risks / Unknowns
- **PWA URL routing**: whether the URL opens in the standalone Stash window vs a Chrome tab
  depends on Chrome's "open supported links in this app" setting. Task is created either way.
  Flagged as a user-side setting, not a code risk.
- **Signed-out drop**: accepted by decision. In practice the session persists, so rare.

## Definition of Done
- [ ] Opening `…/Stash/?add=This%20is%20my%20task%20%23iom` (signed in) creates a task titled
      "This is my task" tagged IOM, with no clicks.
- [ ] Unknown `#tag` stays literal; no context is created.
- [ ] Empty / tag-only `add` creates nothing and opens the app normally.
- [ ] "Added" toast appears with a working Undo that removes the task.
- [ ] Processed once per load; URL query is stripped afterward.
- [ ] Existing `?title/?text/?url` share-target prefill still works unchanged.
- [ ] No new dependencies; `npm run build` (tsc + vite) passes.

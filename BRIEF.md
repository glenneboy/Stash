# Engineering Brief — Live Cross-Device Sync (Supabase Realtime)

## Outcome
A change made on one device (e.g. phone) appears on every other signed-in device (e.g. laptop)
within seconds, with no manual refresh, no app restart, and no "close and reopen" ritual. The
task list and contexts are the same everywhere, all the time.

## Problem (root cause)
`lib/store.ts` only pulls fresh server data at two moments: `init()` (cold start) and the
browser `online` event. There is **no live subscription**. So a write on device A never reaches
device B until B cold-starts or reconnects. Worse, an installed PWA resuming from background does
not re-run `init()`, so it keeps rendering the stale localStorage snapshot — which is why
reopening doesn't fix it.

## In Scope
- **Realtime subscription** to `public.tasks` and `public.contexts`, scoped to the current
  `user_id`, via Supabase `postgres_changes` on the authenticated client.
- **Apply remote changes to the store**: INSERT / UPDATE / DELETE events reconcile into the
  in-memory state and localStorage, then notify React subscribers (existing `set()` path).
- **Conflict rule — protect local edits**: ignore an incoming remote event for any row that
  still has a pending op in the offline write queue. Once that row's op flushes, normal sync
  resumes. Local in-progress/offline edits are never clobbered.
- **Resume refetch**: on `document` `visibilitychange` → visible and `window` `focus`, re-pull
  via the existing `fetchAll()`. Covers the backgrounded-PWA / locked-phone case where the
  websocket slept and missed events.
- **Lifecycle**: subscribe after auth/`init`; unsubscribe and resubscribe cleanly on sign-out /
  sign-in and on `reset()`.
- **DB enablement**: add `tasks` and `contexts` to the `supabase_realtime` publication and set
  `REPLICA IDENTITY FULL` on both (so DELETE events carry `user_id` for filtering). Added to
  `supabase/schema.sql`.

## Out of Scope
- Presence / "another device active" indicators, typing indicators, cursors. (Strictly data sync.)
- `updated_at` columns / timestamp-based merge. (Conflict rule is pending-queue based, not clocks.)
- Field-level / CRDT merge of simultaneous edits to the same field. Row-level reconcile only.
- Any change to the existing optimistic write path, offline queue, swipe/undo, or capture logic
  beyond what's needed to wire in realtime.
- New dependencies. `@supabase/supabase-js` already ships the realtime client.

## Key Flows
- **Remote insert/update**: event arrives → if the row id has a pending queued op, skip →
  otherwise upsert the row into `tasks`/`contexts`, persist, notify. Tasks stay sorted by
  `created_at` desc, contexts by `created_at` asc (matching `fetchAll`).
- **Remote delete**: event arrives → if pending op for that id, skip → otherwise remove the row,
  persist, notify.
- **Resume**: tab becomes visible or window regains focus → `fetchAll()` reconciles the full
  set (also a safety net for any event missed while asleep).
- **Sign-out**: tear down the channel so no events leak across sessions; `reset()` also tears down.

## Edge Cases and Error Handling
- **Echo of own writes**: this device's own insert/update arrives back as a realtime event. The
  pending-queue guard skips it while unsynced; after flush the row already matches, so applying
  it is a no-op. No flespeckering, no duplicates.
- **DELETE payloads**: Postgres only sends the primary key on delete unless `REPLICA IDENTITY
  FULL`. We set FULL so the `user_id` filter holds and we get the old row id reliably.
- **Pending guard correctness**: the guard checks the live offline queue (`readQueue()`), not a
  cached count, so it reflects the true unsynced set at event time.
- **Resort after upsert**: an updated `created_at` (shouldn't change, but defensively) keeps
  ordering stable by re-sorting on every apply.
- **Channel drop / network blip**: realtime auto-reconnects; the resume refetch + existing
  `online` handler + 15s queue retry cover any gap.
- **Unauthenticated / missing session**: no channel is opened until there is a session.

## Tech Stack
- React 18 + TypeScript, Vite. Tailwind (existing dark token set).
- Supabase JS v2 (`@supabase/supabase-js`) — realtime client included.
- Static PWA on GitHub Pages, base `/Stash/`, vite-plugin-pwa (Workbox, autoUpdate).
- Constraint: no new dependencies.

## Non-Functional Requirements
| Area | Requirement |
|---|---|
| Performance | Updates land in seconds; apply path is O(n) over the small per-user list. No polling. |
| Security | Realtime respects RLS via the authed client; channel filtered to `auth.uid()`'s rows. |
| Scalability | One channel, two table subscriptions, per user. Personal-scale data. |
| Resilience | Auto-reconnect + resume refetch + existing offline queue/online retry as safety nets. |
| Observability | N/A (personal app); transient subscribe failures degrade to refetch-on-resume. |
| Compliance | Unchanged — RLS already scopes all rows to the owning user. |

## Integration Points
| Dependency | Protocol | Failure Mode |
|---|---|---|
| Supabase Realtime (`postgres_changes`) | WebSocket via authed supabase-js client | Auto-reconnects; gaps covered by resume refetch + online retry. |
| `supabase_realtime` publication + `REPLICA IDENTITY FULL` | one-time SQL in dashboard | If not run, feature silently does nothing — hard prerequisite. |

## Domain Nomenclature
| Term | Definition |
|---|---|
| Realtime channel | The single Supabase channel carrying `postgres_changes` for this user's tables. |
| Remote event | An INSERT/UPDATE/DELETE broadcast originating from any device (including this one). |
| Pending guard | The rule that skips a remote event whose row id has an unsynced op in the offline queue. |
| Resume refetch | Full `fetchAll()` triggered on tab visible / window focus. |

## Open Risks / Unknowns
- **Hard prerequisite**: Realtime must be enabled for the project AND the two tables added to the
  publication with `REPLICA IDENTITY FULL`. Until the user runs this SQL in Supabase, sync won't
  fire. Flagged as a setup step, not a code risk.
- iOS PWA websocket behaviour when fully backgrounded is OS-throttled; the resume refetch is the
  mitigation. Accepted.

## Definition of Done
- [ ] Editing/adding/deleting on device A reflects on device B within a few seconds, no reload.
- [ ] A remote event does NOT overwrite a row that has an unsynced local edit; it applies after flush.
- [ ] Reopening / refocusing the app pulls the latest state (resume refetch works).
- [ ] Channel is torn down on sign-out and re-established on sign-in; no cross-session leakage.
- [ ] `supabase/schema.sql` includes publication + `REPLICA IDENTITY FULL`; documented as a step.
- [ ] No new dependencies; `npm run build` (tsc + vite) passes.

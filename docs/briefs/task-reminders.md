# Engineering Brief — Task Reminders (Scheduled Web Push)

## Outcome
A user can set a one-off reminder (date + time) on a task. At that moment their device shows a
notification with the task title — **even when the app is closed** — via Web Push. If the
reminder time passes and the task is still not completed, the user is **nudged** on an
escalating schedule until they either complete it or the schedule is exhausted. Notifications
fire across **all** the user's subscribed devices and respect the **device's** silent/DnD mode.

## Users / devices
- Primary user on **Android** (phone) and **macOS** (MacBook), signed in on both.
- iOS is supported only as an **installed (home-screen) PWA** — accepted caveat, not a target to
  optimise for.

## In Scope
- New task field **`reminder_at`** (a single absolute instant; date + time).
- **Notification permission + push subscription** flow, triggered the first time a user sets a
  reminder. No reminder = no permission ask.
- **Service worker push handling**: show the notification on `push`; on `notificationclick`,
  focus/open the app deep-linked to that task.
- **Escalating nudge schedule** for overdue, incomplete tasks (see below).
- **Edge Function on a `pg_cron` schedule** (every minute) that finds due reminders/nudges and
  sends Web Push to all of the user's subscriptions.
- **Subtle bell/time badge** on `TaskItem` for tasks with a pending reminder.
- Setting the reminder lives in the existing **`EditSheet`**, using a native
  `<input type="datetime-local">`.

## Out of Scope (deferred / not building)
- **Inline notification actions** (Complete / Snooze on the notification) — **v2**. MVP is
  **tap-to-open** only.
- **Recurring reminders** — one-off only for now.
- **Server-side quiet hours** — device silent/DnD mode handles silencing.
- **Snooze.**
- Per-device targeting (we fan out to all devices; revisit later if noisy).
- Daily digest / stale-task sweeps unrelated to a set reminder.
- Re-interpreting a reminder to a new timezone if the user travels between setting and firing.

## Escalating Nudge Schedule (canonical)
Stages are computed as offsets from the original `reminder_at`. Each fires only if the task is
still **incomplete** at that time:

| Stage | When | Offset from `reminder_at` |
|---|---|---|
| 0 | On time | +0 |
| 1 | An hour later | +1 hour |
| 2 | The next day | +1 day |
| 3 | Three days after stage 2 | +4 days |
| 4 | A week after stage 3 | +11 days |
| — | Gives up | no further notifications |

> **Confirm interpretation:** the gaps are cumulative ("an hour after → the next day → 3 days
> later → 1 week later"), giving offsets **+1h, +1d, +4d, +11d**. If you meant the later gaps to
> be measured from `reminder_at` instead (+1h, +1d, +3d, +7d), say so before sign-off.

Completing the task at any point stops all further nudges. Changing the reminder resets the
schedule to stage 0 at the new time.

## Key Flows
- **Set a reminder**: open task in `EditSheet` → pick date+time → save. First time ever:
  browser prompts for notification permission; on grant, the device subscribes to push and the
  subscription is stored. The task shows the bell badge.
- **Fire on time**: cron sees `reminder_at` due, task incomplete → pushes to all devices →
  notification shows the task title. Tapping it opens the app focused on that task.
- **Nudge**: task still incomplete at +1h → push again; repeat per schedule until completed or
  exhausted.
- **Change reminder**: pick a new time → old schedule discarded, new schedule starts at the new
  time (auto-cancel + replace).
- **Remove reminder**: clear the field → no further notifications; badge disappears.
- **Complete the task**: any pending/overdue schedule stops immediately.

## Edge Cases and Error Handling
- **Permission denied/blocked**: reminder is still saved, but the app surfaces that
  notifications are off and it won't fire until permission is granted.
- **Subscription expired/invalid** (push service returns 404/410): delete that subscription row;
  remaining devices still receive the push.
- **Task completed before a stage fires**: cron skips completed tasks; the schedule is cleared.
- **Task deleted**: reminder/schedule goes with it (FK cascade).
- **Multiple devices, some unsubscribed**: fan out to whatever subscriptions exist.
- **Device in silent/DnD**: notification still delivered, silenced by the OS (intended).
- **Reminder set in the past**: fires on the next cron tick (treated as immediately due).

## Tech Stack
- Language/Framework: React 18 + TypeScript, Vite, Tailwind (existing).
- Backend: Supabase (Postgres + RLS + Auth + Realtime), existing.
- PWA: `vite-plugin-pwa` — **switch from generated SW to `injectManifest`** so we can own a
  custom service worker for `push` / `notificationclick`.
- Scheduler: **`pg_cron`** (Supabase) invoking a Supabase **Edge Function** (Deno) every minute.
- Deployment target: existing `tsc && vite build`; Edge Function + cron deployed to Supabase.

## New Dependencies (require approval per project rules)
- **Server-side only**: a Web Push library in the Edge Function (Deno-compatible, e.g.
  `web-push`) to sign/send pushes with VAPID. Lives in the function, **not** the client bundle.
- **Client-side**: none expected — push subscription uses native browser APIs plus the existing
  service worker. (Flag if any helper proves necessary.)

## Data Model Changes
- `tasks`: add `reminder_at timestamptz null`, plus internal scheduling fields
  `notify_next_at timestamptz null` and `notify_stage int not null default 0`.
- New table `push_subscriptions` (`user_id`, `endpoint` unique, `p256dh`, `auth`, `created_at`)
  with RLS scoped to `auth.uid()`, mirroring the existing own-rows policies.
- VAPID public/private keys stored as Edge Function secrets; public key shipped to the client
  for `pushManager.subscribe`.

## Non-Functional Requirements
| Area | Requirement |
|---|---|
| Performance | Cron query is an indexed lookup on `notify_next_at <= now()` where incomplete; tiny volume. |
| Security | See **Security Model** below. End-to-end encrypted payloads (RFC 8291); VAPID-restricted sends; RLS on `push_subscriptions`; secrets only in Edge Function env; authenticated cron→function trigger; dead-subscription pruning. |
| Scalability | Single-user scale; per-minute cron is ample. |
| Resilience | Invalid subscriptions pruned on send failure; missed ticks self-heal (next tick re-queries due rows). |
| Observability | Edge Function logs sends, failures, and pruned subscriptions. |
| Compliance | No new sensitive data beyond push endpoints; cascade-deleted with the user. |

## Security Model
Standard Web Push security; secure provided the following are enforced (all in scope):

**Strong by design**
- **End-to-end encrypted payloads** (RFC 8291, via the `web-push` lib): the push service relays
  ciphertext only and cannot read the task title. Decryptable solely by the subscribed browser.
- **VAPID-restricted sends**: subscriptions are bound to our public key; the push service rejects
  any push not signed by our matching **private** key. A leaked endpoint alone cannot be used to
  notify the user.
- **Endpoints are write-only** delivery addresses — they expose no read access to user data.

**Enforced controls (build requirements)**
1. VAPID **private** key + Supabase **service-role** key live only in Edge Function secrets —
   never in the client bundle or git. VAPID **public** key is shipped to the client (intended).
2. **RLS** on `push_subscriptions` scoped to `auth.uid()`.
3. **Authenticated** cron→Edge-Function trigger (service role / shared secret verified in the
   function) — no open endpoint that can spoof or fan out sends.
4. **Prune** subscriptions on push 404/410.

**Accepted residual risks (inherent to Web Push)**
- Push service sees metadata (endpoint, timing, size) — never content.
- Task title is visible on the lock screen (generic-text toggle is a possible v2, out of scope).
- Theft of the VAPID private key would allow spoofed notifications *to* the user (not data
  access); mitigated by secret storage and rotation if leaked.

## Integration Points
| Dependency | Protocol | Failure Mode |
|---|---|---|
| Web Push services (FCM/Mozilla/Apple) | Web Push protocol (VAPID) | 4xx → prune subscription; transient 5xx → retried next tick |
| Supabase `pg_cron` | scheduled SQL → Edge Function HTTP | missed tick recovered on next run |
| Browser Push/Notification APIs | native | permission denied → reminder saved but inert, user told |

## Domain Nomenclature
| Term | Definition |
|---|---|
| Reminder | The user-set instant (`reminder_at`) a task should first notify. |
| Nudge | A follow-up notification for an overdue, still-incomplete task. |
| Stage | Position in the escalating nudge schedule (0 = on time). |
| Subscription | A device's Web Push registration stored in `push_subscriptions`. |
| Fire | The act of delivering a push for a due reminder/nudge. |

## Open Risks / Unknowns
- **Nudge gap interpretation** (cumulative vs from-`reminder_at`) — to confirm at sign-off.
- **Edge Function ↔ cron auth** specifics (service-role vs signed invocation) — finalise in
  implementation; doesn't change scope.
- **`injectManifest` migration**: must verify the existing offline/precache behaviour from
  `vite-plugin-pwa` is preserved after taking over the service worker.

## Definition of Done
- [ ] `reminder_at` settable/clearable on a task via `EditSheet` (native datetime picker).
- [ ] First reminder triggers the permission prompt; granting stores a push subscription.
- [ ] Permission-denied path saves the reminder but tells the user it won't fire.
- [ ] On-time notification shows the task title with app closed; tap opens app on that task.
- [ ] Escalating nudges fire per the confirmed schedule and stop on completion/removal.
- [ ] Changing a reminder cancels the old schedule and starts a new one.
- [ ] Notifications fan out to all of the user's devices; invalid subscriptions are pruned.
- [ ] Subtle bell/time badge on `TaskItem` for tasks with a pending reminder.
- [ ] `pg_cron` + Edge Function deployed and verified end-to-end.
- [ ] Security controls 1–4 (Security Model) enforced: secrets out of client/git, RLS on
      `push_subscriptions`, authenticated cron trigger, dead-subscription pruning.
- [ ] `tsc && vite build` passes; existing PWA offline behaviour intact after SW migration.

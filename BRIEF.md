# Engineering Brief — Profile Sharing (Collaboration)

> Status: **awaiting sign-off**. No code until confirmed.
> Prior brief archived at `docs/briefs/task-reminders.md`.

## Outcome

Glenn creates a profile ("Trip"), invites his wife and son by email, and once they accept, all
three add, edit, complete and delete tasks and tags in that profile from their own devices —
seeing each other's changes live, exactly as if it were their own list syncing across their own
devices. Glenn owns it: only he can invite, revoke, rename, or delete the profile.

The reference use case is a **family holiday** — a shared list of things to do, pack and sort
before going away.

## Roles

| Role | Can |
|---|---|
| **Owner** | Everything a member can, plus: invite, revoke, cancel invites, rename, **delete the profile**. Exactly one per profile, set at creation. Not transferable (out of scope). |
| **Member** | Add / amend / delete tasks and tags in the profile. Can **leave** the profile. Cannot invite, revoke, rename or delete the profile. |

Privileges are uniform — there is no view-only or partial access tier.

## In Scope

- **Membership model.** A profile has one owner and any number of members (unbounded).
- **Invite by email.** Owner enters an email address. Emails are normalised (trimmed,
  lowercased) so `Wife@Gmail.com` and `wife@gmail.com` are one person.
- **Accept / reject in-app.** An invite appears as a pending card in the recipient's app. It
  becomes a real profile in their switcher only on **accept**. Reject deletes the invite; the
  owner may re-invite afterwards.
- **Owner-owns-everything.** Every task and tag inside a profile belongs to the profile owner,
  regardless of who created it, enforced as a **database trigger** that stamps
  `user_id = <profile owner>` on insert. Members write freely; the rows are still the owner's.
- **Realtime sync for members.** A member's device receives live inserts/updates/deletes for
  shared profiles, same experience as own-device sync today.
- **Shared badge.** Shared profiles are visually marked in the switcher, so a shared "Trip" is
  distinguishable from a personal profile of the same name.
- **Revoke.** Owner removes a member at any time. Access ends immediately; nothing is deleted,
  because the member never owned anything.
- **Leave.** A member can remove themselves without asking the owner.
- **Cancel pending invite.** Owner can withdraw an invite that hasn't been accepted (typo recovery).
- **Owner delete = nuclear.** Deleting a profile removes its tasks, tags, memberships and
  invites for everyone. When the profile has members, the confirmation must **say so explicitly**
  before proceeding. No undo, for anyone.
- **Reminders fan out.** A reminder on a task in a shared profile notifies **every accepted
  member plus the owner** (decision 4.1a).

## Out of Scope

- Per-person permission tiers (view-only, comment-only).
- Ownership transfer.
- Per-task assignment ("this one's yours").
- Comments, chat, activity feed, edit history.
- Attribution — the UI will never show who added or changed a task.
- **Email notification of invites** (see Open Risks). MVP is in-app only.
- Push notification for a new invite — in-app banner only for MVP.
- Sharing the **Personal** profile. It is `profile_id = null`, has no row and no id, and means
  something different for every user. It stays private, always. It is the only guaranteed-private
  profile.
- Conflict-resolution UI. Last-write-wins is accepted.

## Key Flows

**Share.** Owner opens a profile in ProfileManager → Share → types an email → invite created as
`pending`. Owner sees the pending invite listed and can cancel it.

**Receive.** Invitee opens Stash → pending-invite card ("Glenn invited you to Trip") →
Accept or Reject. On accept the profile appears in their switcher with a shared badge, fully
populated. On reject the invite disappears.

**Collaborate.** Any member adds/edits/completes/deletes tasks and tags. Changes propagate live
to every other member. Completing a task completes it for everyone.

**Revoke.** Owner opens the profile's member list → removes a member. That member's device drops
the profile on next sync.

**Leave.** Member opens the shared profile → Leave → it disappears from their switcher. Owner
sees them gone from the member list.

**Delete.** Owner deletes the profile → confirmation names the collaborators and warns they lose
everything → on confirm, tasks, tags, memberships and invites are all removed for all parties.

## Edge Cases and Error Handling

| Case | Behaviour |
|---|---|
| Invite sent to an email with no Stash account | Invite sits `pending` indefinitely; it activates when that email first signs in. No email is sent in MVP (see Open Risks). |
| Typo'd email | Owner cancels the pending invite. |
| Rejected invite | Deleted. Owner may re-invite. |
| Duplicate invite to the same email | No-op / surfaces the existing pending invite; never creates a second. |
| Owner invites themselves | Rejected. |
| Concurrent edits (incl. offline queues) | **Last-write-wins**, no conflict UI. A member's offline edit to a task another member deleted will resurrect it. Accepted. |
| Member revoked while offline | Queued writes that now fail RLS are **dropped silently**; the local copy of the profile is purged on next sync. |
| Name collision (own "Trip" vs shared "Trip") | Both shown; shared one carries the badge. The `?profile=<name>` deeplink resolves to **the user's own profile first**. |
| Tags in a shared profile | Shared. Any member can create, rename or delete them. |
| Owner deletes their Stash account | The profile and all its contents go with them, for everyone. Consequence of owner-owns-everything; accepted. |
| Member deletes their Stash account | Nothing is lost from the profile — they owned nothing. Their membership disappears. |

## Tech Stack

- **Language/Framework:** React + TypeScript + Vite (unchanged).
- **Data:** Supabase Postgres + RLS + Realtime; email OTP / magic-link auth.
- **Platform:** PWA on GitHub Pages, Vite `base` `/Stash/`.
- **State:** existing offline-first localStorage store (`src/lib/store.ts`) with op-replay queue.
- **Module name:** `sharing` — `src/lib/sharing.ts`, `supabase/migrations/*_profile_sharing.sql`.

### Implementation constraints already identified

1. **RLS today is `auth.uid() = user_id`** on tasks, contexts and profiles. It must become
   "mine, **or** a profile I'm an accepted member of". This is a rewrite of the core security
   policy, not an addition — it needs deliberate testing.
2. **Recursive-policy footgun.** Membership policies that reference `profiles`, and profile
   policies that reference membership, will recurse. Resolve with a `SECURITY DEFINER` helper
   function rather than nested policy subqueries.
3. **Realtime is currently filtered `user_id=eq.<me>`.** Under owner-owns-everything a member
   would receive nothing. The client must additionally subscribe per shared profile
   (`profile_id=eq.<id>`), and resubscribe when membership changes.
4. **The reminder Edge Function targets `task.user_id`.** It must fan out to the profile's
   members, or a shared reminder buzzes only the owner.
5. **Optimistic local rows** will carry the writer's own `user_id` until the server echo
   corrects it. Client logic must not key off `user_id` for visibility.
6. **`profiles.user_id` cascades from `auth.users`.** Left as-is, deliberately: owner deletion
   destroying the profile is the accepted semantic.
7. Migration must be **additive and safe with older clients live** — same discipline as the
   profiles migration.

## Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Household scale (3–5 members, hundreds of tasks). No pagination or query optimisation needed. Realtime propagation should feel immediate (~1s). |
| Security | RLS is the sole enforcement boundary — never client-side checks. A non-member must not be able to read a single row of a profile. Owner-only actions enforced in the database, not just hidden in the UI. |
| Privacy | The UI must **not** reveal whether an invited email belongs to an existing Stash user. A member's email is visible only to the profile owner and to that member — never to other members. |
| Scalability | Unbounded members by design; no cap enforced or engineered for. |
| Resilience | Offline queue behaviour unchanged; failed writes after revocation are dropped, not retried forever. |
| Observability | None beyond existing behaviour. No audit log (explicitly out of scope). |
| Compliance | None. Personal-use app. |

## Integration Points

| Dependency | Protocol | Failure mode |
|---|---|---|
| Supabase Postgres + RLS | PostgREST over HTTPS | Writes fail → existing offline queue retries; post-revocation failures dropped silently |
| Supabase Realtime | WebSocket | Falls back to the existing refresh-on-load sync; no data loss |
| `send-reminders` Edge Function + `pg_cron` | HTTPS / Web Push | Reminder missed; not data-affecting |
| Transactional email | — | **Not integrated in MVP** |

## Domain Nomenclature

| Term | Definition |
|---|---|
| **Owner** | The user who created the profile. Exactly one. Sole holder of profile-level powers. |
| **Member** | A user with accepted access. Full add/amend/delete on the profile's contents. |
| **Invite** | A pending offer to an email address. States: `pending` → `accepted` / `rejected`; cancellable by the owner while pending. |
| **Shared profile** | A profile with at least one member. Badged in the switcher. |
| **Personal** | The implicit default profile (`profile_id = null`). Private, unshareable. |
| **Revoke** | Owner removing a member. |
| **Leave** | Member removing themselves. |

## Open Risks / Unknowns

1. **No email means invites are undiscoverable to non-users.** MVP assumes the invitee already
   has Stash installed, or that the owner tells them out-of-band ("install this and sign in with
   your gmail — there's an invite waiting"). Accepted for MVP because the first collaborators
   already use the app. This is the first thing to revisit if sharing goes beyond the household.
2. **LWW will lose edits** in genuine concurrent use. Accepted; a packing list is forgiving.
   Deleted-then-edited tasks will reappear.
3. **The RLS rewrite touches live production data** for the existing single user. Needs careful
   staged verification — a policy mistake either locks the owner out or exposes rows.
4. **Reminder fan-out may be noisy** (every member buzzed by every shared reminder). Accepted
   deliberately for the trip use case; revisit if it annoys.

## Definition of Done

- [ ] Owner can share a profile by email; invite appears as pending, and can be cancelled.
- [ ] Invitee sees a pending-invite card in-app and can accept or reject.
- [ ] On accept, the profile appears in their switcher **with a shared badge**, fully populated.
- [ ] All members can add, amend, complete and delete tasks and tags in the profile.
- [ ] A change by one member appears live on another member's device without a refresh.
- [ ] Completing a task completes it for everyone.
- [ ] Every task/tag written by a member is stored owned by the profile owner (verified in DB).
- [ ] Non-members cannot read or write the profile's rows — verified against RLS directly, not
      just through the UI.
- [ ] The invite flow does not reveal whether an email has a Stash account.
- [ ] Owner can revoke a member; that member loses the profile on next sync, silently.
- [ ] A member can leave a profile of their own accord.
- [ ] Only the owner sees share / revoke / rename / delete controls, and only the owner can
      perform them at the database level.
- [ ] Deleting a shared profile warns that collaborators will lose everything, names them, and on
      confirm removes tasks, tags, memberships and invites for all parties.
- [ ] A reminder on a shared task notifies every member and the owner.
- [ ] Personal profile has no Share affordance.
- [ ] `?profile=<name>` prefers the user's own profile on a name collision.
- [ ] Existing single-user behaviour is unchanged; migration is additive and safe with older
      clients live.
- [ ] `npx tsc --noEmit` and `npm run build` clean; unit tests for the sharing lib.
- [ ] Verified at a ~390px mobile viewport.

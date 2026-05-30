# Engineering Brief — Swipe + Undo, Inline #tag Capture, Share Target

## Outcome
Three additions that reinforce Stash's "capture now, sort never" philosophy without adding a
second organizing axis:
1. Faster, safer task actions (swipe + undo).
2. Tagging without leaving the single capture field (inline `#tag`).
3. Capture from outside the app (PWA share target).

## In Scope
- **Swipe gestures** on a task row: swipe right → complete, swipe left → delete. Hand-rolled
  with native pointer events (no new dependency). Coexists with existing checkbox-tap (complete)
  and body-tap (edit) without firing them accidentally.
- **Undo toast** for both delete and complete. 5-second auto-dismiss, single "Undo" action.
  Delete restores the full task row (same id, re-sorted by `created_at`). Complete toggles back.
- **Inline `#tag` capture**: typing `buy cables #work` applies the matching context (by name,
  case-insensitive) and strips the token from the title. Unmatched `#word` is left as literal
  text. Combines with any tags already selected / the active filter context.
- **PWA share target**: shared title/text/url opens Stash with the capture bar prefilled; the
  user confirms with one tap (and can add a context first). `method: GET`, query params, URL
  cleaned after read.

## Out of Scope
- Auto-creating contexts from unmatched tags.
- Live `#tag` highlighting while typing (parse on submit only — no new UI).
- iOS share target (platform doesn't support Web Share Target — accepted limitation).
- Reordering, due dates, or anything from the "out of scope" section of BACKLOG.md.

## Key Flows
- **Swipe complete/delete**: pointer down on row → if horizontal drag dominates, translate the
  foreground and reveal a colored action layer (accent+check on the left, red+trash on the
  right) → release past ~80px threshold fires the action → an Undo toast appears.
- **Inline tag**: submit → parse `#token`s → matched tokens become context ids and are removed
  from the title → task created with union of typed + selected tags.
- **Share**: external app → "Share to Stash" → app opens at `/Stash/?title=…&text=…&url=…` →
  capture bar prefilled with the composed text → user taps Add.

## Edge Cases and Error Handling
- Swipe that doesn't pass threshold snaps back, fires nothing, and suppresses the trailing click.
- Vertical scroll is preserved (`touch-action: pan-y`); only horizontal-dominant drags swipe.
- Title that becomes empty after stripping tags (e.g. just `#home`) creates nothing.
- Undo after delete re-enqueues an insert; offline queue handles it like any other write.
- Share params absent → app behaves normally; capture bar empty.
- Duplicate tag ids are de-duplicated.

## Tech Stack
- Language/Framework: React 18 + TypeScript, Vite.
- Styling: Tailwind (existing dark token set: bg, surface, elevated, line, muted, accent).
- Data: Supabase (Postgres + RLS) via the custom optimistic store + offline queue in `lib/store.ts`.
- Platform: Static PWA on GitHub Pages, base `/Stash/`, vite-plugin-pwa (Workbox, autoUpdate).
- Constraint: no new dependencies (frontend is currently dependency-free beyond React/Supabase).

## Non-Functional Requirements
| Area | Requirement |
|---|---|
| Performance | All actions optimistic/local; swipe at 60fps via transform only. |
| Security | Unchanged — RLS already scopes all rows to the user. |
| Scalability | N/A (per-user task list). |
| Resilience | Undo/restore use the existing offline write queue. |
| Observability | N/A. |
| Compliance | N/A. |

## Integration Points
| Dependency | Protocol | Failure Mode |
|---|---|---|
| Supabase tasks table | existing store ops (insert/update/delete) | queued offline, retried |
| Web Share Target API | manifest `share_target`, GET query params | unsupported on iOS → feature absent, app unaffected |

## Domain Nomenclature
| Term | Definition |
|---|---|
| Context | A user-curated tag (IOM/Work/Home/Personal…); the one organizing axis. |
| Capture | Adding a task via the always-visible single input. |
| Toast | Transient bottom banner with an Undo action. |
| Swipe action | Horizontal drag on a task row that completes (right) or deletes (left). |

## Open Risks / Unknowns
- iOS cannot use the share target. Accepted.
- Some apps send identical `text` and `url` on share → minor duplication in the prefilled
  string. Accepted (user edits before saving).

## Definition of Done
- [ ] Swipe right completes, swipe left deletes; vertical scroll still works; no accidental
      edit/complete from a swipe.
- [ ] Undo toast appears for delete and complete and correctly reverses each within 5s.
- [ ] `#existingcontext` in capture applies that context and is stripped; unmatched `#word` stays.
- [ ] `share_target` declared; sharing into the installed app prefills the capture bar.
- [ ] No new dependencies; `npm run build` (tsc + vite) passes.

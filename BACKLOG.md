# Stash — Backlog

Tracking feature ideas. Guiding principle: **capture now, sort never.** One organizing
axis (contexts). If an item starts turning Stash into a project manager, it doesn't belong here.

## Done (built, pending interactive sign-off in a logged-in session)

- [x] **Swipe gestures + undo** — swipe right to complete, left to delete; 5s "Undo" toast for
  both delete and complete. Hand-rolled pointer events (no dependency).
- [x] **Inline `#tag` capture** — typing `buy cables #work` applies the Work context and strips
  the token; unmatched `#word` stays literal. Parsed on submit, no new UI.
- [x] **PWA share target** — `share_target` in the manifest (GET); shared text/links open Stash
  with the capture bar prefilled. (Android/Chrome only — iOS lacks Web Share Target.)

## Backlog

### Worth doing
- [ ] **Search** — client-side filter on title/note. Essential once the stash grows large.
- [ ] **Live cross-device sync** — Supabase Realtime subscriptions so changes appear instantly
  on other devices (currently only fetches on load).

### Polish
- [ ] **Date grouping** — Today / Yesterday / Earlier. Light structure, no sorting required.
- [ ] **Clear completed** — button to clear the completed section so it doesn't grow forever.
- [ ] **Haptics + animation on complete** — tactile feedback to reinforce the habit.
- [ ] **Export** — copy as Markdown / JSON. Cheap backup and escape hatch.

## Out of scope (deliberately)

These would turn Stash into a Swiss army knife. Resist unless the philosophy changes:
due dates & reminders, recurring tasks, subtasks/checklists, projects/folders beyond contexts,
priority levels, sharing/collaboration, calendar integration.

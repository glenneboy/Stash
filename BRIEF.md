# Engineering Brief — Multi-Context Select (Sticky + Transient Views)

_GitHub issue #6 (glenneboy/Stash)._

## Outcome
The user can combine several contexts into one filter "view" and see the **intersection** of
those contexts (a task shows only if it carries *every* selected context). The existing
single-tap-to-switch behaviour is preserved. Long-pressing a context "pins" it so it persists
across taps; a quick tap selects one context transiently. Any task captured while a view is
active is auto-tagged with all contexts in that view.

## Selection Model (canonical)
State = a set of **sticky** contexts (any number) + at most one **transient** context.

- **Long press** a chip → toggles its sticky state (add if absent, remove if present).
- **Quick press** a chip:
  - If it's the current transient → clear the transient (toggle off).
  - Else if it's sticky → un-stick it (remove from view); the transient is left untouched.
  - Else → it becomes the transient, replacing the previous transient.
- The transient is cleared only when a *new* selection is made (a quick tap on an unselected
  context, or long-pressing a context into sticky). Removing a context (un-sticking it, or
  tapping the transient off) never disturbs the rest. Only one transient can exist at a time.
- **All** chip → clears everything (stickies + transient); shows all tasks.
- **View** = intersection of `[...stickies, transient]`. Empty selection → all tasks (today's
  "All" behaviour).

## In Scope
- Replace the single `Filter` value in `Home.tsx` with the sticky-set + transient model above.
- `matchesFilter` becomes an intersection test over the selected context ids.
- `FilterBar` chips gain: long-press detection (pointer events, ~500ms), a sticky vs transient
  visual, and the new press semantics. "All" chip clears the selection.
- **Sticky indicator**: a small filled dot on sticky chips. Transient chips keep the existing
  accent fill only (no dot).
- **Long-press input**: press-and-hold via pointer events (~500ms), one code path for touch and
  mouse. Early move/release cancels (so the chip row still scrolls). Haptic feedback on trigger,
  matching the existing complete-task haptics.
- **Capture tagging**: every context in the current view (stickies + transient) is auto-applied
  to a task added while that view is active. `CaptureBar` takes `activeContextIds: string[]`
  instead of a single `activeContextId`, and reflects the current view.

## Out of Scope
- Union ("any of") views — issue specifies intersection only.
- Persisting the selected view across reloads (selection stays ephemeral component state, as
  today).
- Saving named views.
- Changes to search, sort, completed section, ContextManager, store, or sync.
- New dependencies.

## Key Flows
- **Switch (unchanged)**: no stickies; tap A → view = A; tap B → view = B.
- **Pin then add**: long-press A (A sticky, dot shown) → tap B (view = A ∩ B, B transient) →
  tap C (view = A ∩ C, B dropped) → long-press C (C sticky, transient cleared, view = A ∩ C) →
  tap B (view = A ∩ C ∩ B).
- **Un-stick by tap**: A sticky → quick-tap A → A removed from view.
- **Capture in view**: view = A ∩ B → add "foo" → task created tagged [A, B] (still editable via
  the capture `#` tag panel before submit).
- **All**: any selection → tap All → cleared, all tasks shown.

## Edge Cases and Error Handling
- Quick-press the current transient → toggles it off.
- Quick-press a sticky chip → removes that sticky; the transient is left untouched.
- Long-press the current transient → it becomes sticky, transient cleared.
- Empty intersection → list shows the existing empty/no-match state.
- A deleted context disappears from chips; if it was selected it simply drops out of the set.
- Press-and-hold then scroll → movement cancels the long-press timer; treated as a scroll, not a
  selection change.

## Tech Stack
- Language/Framework: React 18 + TypeScript, Vite, Tailwind.
- Platform: mobile-first PWA, also used on desktop.
- Deployment target: existing build (`tsc && vite build`).
- Constraints: use existing patterns; no new dependencies.

## Non-Functional Requirements
| Area | Requirement |
|---|---|
| Performance | Pure client-side filter over already-loaded tasks; intersection test is O(tasks × selected). Negligible. |
| Security | None — no new data paths. |
| Scalability | n/a (local list). |
| Resilience | n/a. |
| Observability | n/a. |
| Compliance | n/a. |

## Integration Points
| Dependency | Protocol | Failure Mode |
|---|---|---|
| `CaptureBar` | props (`activeContextIds`) | n/a — local prop |
| `useStore` (tasks, contexts) | existing hook | unchanged |

## Domain Nomenclature
| Term | Definition |
|---|---|
| Sticky | A context pinned via long-press; persists in the view until toggled off. |
| Transient | The single quick-tapped context; wiped when any other context is pressed. |
| View | The active set of selected contexts; tasks shown = intersection of them. |
| Selected | Union of stickies + the transient. |

## Open Risks / Unknowns
- None outstanding — all interaction decisions confirmed during the grill.

## Definition of Done
- [ ] Long-press toggles sticky; sticky chips show the dot indicator.
- [ ] Quick-press follows the transient/un-stick rules above.
- [ ] View shows the intersection of selected contexts; empty selection shows all.
- [ ] "All" clears the selection.
- [ ] Captured tasks are auto-tagged with all contexts in the current view.
- [ ] Press-and-hold works on touch and mouse; scrolling the chip row is unaffected.
- [ ] `tsc && vite build` passes.

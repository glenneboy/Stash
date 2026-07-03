-- ── Recurrence ──────────────────────────────────────────────
-- recur: optional repeat rule as jsonb, e.g. {"unit":"week","interval":1}.
-- null = not recurring. On completion the client marks the task done and
-- inserts the next occurrence (due date advanced by the rule), so the
-- completed row stays in Done as a record.
alter table public.tasks add column if not exists recur jsonb;

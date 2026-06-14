-- ── Due dates ───────────────────────────────────────────────
-- due_on: optional calendar day a task is due (separate from reminder_at,
-- which is an absolute push-notification instant). Day granularity, no time —
-- it drives the urgency badge (overdue/soon/upcoming) shown on each task.
alter table public.tasks add column if not exists due_on date;

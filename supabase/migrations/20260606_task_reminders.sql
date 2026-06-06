-- ── Reminders (scheduled web push) ──────────────────────────
-- reminder_at  : user-set instant the task first notifies (absolute UTC).
-- notify_next_at: next instant the cron should fire (null = nothing pending).
-- notify_stage : index of the next stage to fire (0=on-time,1..4=nudges).
alter table public.tasks add column if not exists reminder_at   timestamptz;
alter table public.tasks add column if not exists notify_next_at timestamptz;
alter table public.tasks add column if not exists notify_stage  int not null default 0;

create index if not exists tasks_notify_next_at_idx
  on public.tasks (notify_next_at) where notify_next_at is not null;

-- ── Push subscriptions (one row per device/browser) ─────────
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- ── Row-Level Security ──────────────────────────────────────
alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Stash — database schema + row-level security
-- Run this in the Supabase SQL editor for your new project.

-- ── Contexts ────────────────────────────────────────────────
-- Tags that group tasks by life area. User-editable; new users start
-- with no contexts and create their own.
create table if not exists public.contexts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create index if not exists contexts_user_id_idx on public.contexts (user_id);

-- ── Tasks ───────────────────────────────────────────────────
-- A task may belong to zero or more contexts (array of context ids).
-- An empty array means "untagged" — visible in All and every filter.
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title        text not null,
  note         text,
  contexts     uuid[] not null default '{}',
  completed    boolean not null default false,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  due_on       date
);

create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_contexts_idx on public.tasks using gin (contexts);

-- due_on: optional calendar day a task is due (drives the urgency badge in the UI).
alter table public.tasks add column if not exists due_on date;

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
alter table public.contexts enable row level security;
alter table public.tasks    enable row level security;

drop policy if exists "own contexts" on public.contexts;
create policy "own contexts" on public.contexts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Realtime (live cross-device sync) ───────────────────────
-- Broadcast row changes so every signed-in device stays in sync.
-- REPLICA IDENTITY FULL makes DELETE events carry the whole old row
-- (incl. user_id) so the client's user_id filter applies to deletes too.
alter table public.tasks    replica identity full;
alter table public.contexts replica identity full;

-- Add both tables to Supabase's realtime publication (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contexts'
  ) then
    alter publication supabase_realtime add table public.contexts;
  end if;
end $$;

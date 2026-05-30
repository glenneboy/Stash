-- Stash — database schema + row-level security
-- Run this in the Supabase SQL editor for your new project.

-- ── Contexts ────────────────────────────────────────────────
-- Tags that group tasks by life area (IOM, Work, Home, Personal).
-- User-editable; the app seeds the four defaults on first login.
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
  completed_at timestamptz
);

create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_contexts_idx on public.tasks using gin (contexts);

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

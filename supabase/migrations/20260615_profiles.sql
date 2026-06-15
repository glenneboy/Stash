-- Profiles: a named partition of a user's tasks + contexts (e.g. "Work", "Home").
--
-- Backwards compatibility: profile_id is nullable and a NULL value means the
-- implicit "Personal" (default) profile. Every pre-existing task/context already
-- has NULL here, and any insert from an older app version (which doesn't set the
-- column) also lands in Default — so this migration is additive and safe to run
-- while older clients are still live. No backfill, no NOT NULL, no data loss.

create table if not exists public.profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles (user_id);

-- on delete cascade: deleting a profile removes its tasks + contexts in one shot.
alter table public.tasks
  add column if not exists profile_id uuid references public.profiles (id) on delete cascade;
alter table public.contexts
  add column if not exists profile_id uuid references public.profiles (id) on delete cascade;

create index if not exists tasks_profile_id_idx    on public.tasks (profile_id);
create index if not exists contexts_profile_id_idx on public.contexts (profile_id);

-- ── Row-Level Security ──────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "own profiles" on public.profiles;
create policy "own profiles" on public.profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Realtime (live cross-device sync) ───────────────────────
alter table public.profiles replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

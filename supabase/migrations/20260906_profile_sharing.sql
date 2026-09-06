-- Profile sharing: one owner, any number of members, per profile.
--
-- Owner-owns-everything. A profile has exactly one owner (profiles.user_id) and
-- every task/context inside it carries user_id = <that owner>, no matter who wrote
-- it. A BEFORE INSERT OR UPDATE trigger stamps that, so a member's write is legal
-- without the client knowing whose row it becomes. Nothing is "co-owned": revoking
-- a member therefore deletes nothing, because they never owned a row.
--
-- Personal (profile_id is null) is untouched by all of this. It has no profiles row,
-- so it can never be a member of anything and stays strictly private to its owner.
--
-- Why the helpers are SECURITY DEFINER. The profiles select policy has to ask
-- "am I a member of this profile?" and the profile_members select policy has to ask
-- "do I own this profile?". Written as inline policy subqueries those two policies
-- read each other's tables and Postgres recurses (error 42P17). Wrapping each
-- question in a SECURITY DEFINER function makes the lookup run as the function owner,
-- which is not subject to RLS, so the recursion is cut. Do NOT inline these back into
-- the policies. They are `stable` (one evaluation per statement, not per row) and
-- pin search_path so a definer function can't be hijacked by a shadowing schema.
--
-- Backwards compatibility: additive and safe to run while older clients are live.
-- The RLS rewrite below is a strict superset of the old `auth.uid() = user_id`
-- policies — every row an existing user could read or write before, they still can —
-- so an old client that knows nothing about profile_members carries on working.

-- ── Membership ──────────────────────────────────────────────
-- One row per person invited to a profile. The row IS the invite: it exists as
-- 'pending' from the moment the owner sends it and flips to 'accepted' in place.
-- Reject / revoke / leave all just delete the row, so the owner can re-invite.
--
-- Invites are matched by email, not user id, so an invite can be sent to someone
-- with no Stash account yet — it simply sits pending until that email signs in.
-- email is normalised (lower(trim(...))) by the trigger below, so Wife@Gmail.com
-- and wife@gmail.com are one person and unique (profile_id, email) means what it says.
create table if not exists public.profile_members (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  email       text not null,
  user_id     uuid references auth.users (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  invited_by  uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (profile_id, email)
);

create index if not exists profile_members_profile_id_idx on public.profile_members (profile_id);
create index if not exists profile_members_user_id_idx    on public.profile_members (user_id);
create index if not exists profile_members_email_idx      on public.profile_members (email);

-- Normalise on the way in rather than rejecting a mis-cased email: the client
-- normalises too, but the uniqueness guarantee has to hold whatever writes the row
-- (including the accept RPC's email match, which compares against lower()).
create or replace function public.normalize_member_email()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists profile_members_normalize_email on public.profile_members;
create trigger profile_members_normalize_email
  before insert or update on public.profile_members
  for each row execute function public.normalize_member_email();

-- ── RLS helpers (SECURITY DEFINER — see header) ─────────────

-- The profile's owner, or null if the profile is gone (or p is null).
create or replace function public.profile_owner(p uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select user_id from public.profiles where id = p;
$$;

-- True when the caller has an ACCEPTED membership of p. Pending invites grant nothing.
create or replace function public.is_profile_member(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profile_members m
    where m.profile_id = p
      and m.user_id = auth.uid()
      and m.status = 'accepted'
  );
$$;

-- True when the caller may write inside p — owner or accepted member. Uniform
-- privileges by design: there is no view-only tier. Null p (Personal) is never
-- writable through this path; the policies handle Personal separately.
create or replace function public.can_write_profile(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p is not null and (
    (select user_id from public.profiles where id = p) = auth.uid()
    or exists (
      select 1 from public.profile_members m
      where m.profile_id = p
        and m.user_id = auth.uid()
        and m.status = 'accepted'
    )
  );
$$;

grant execute on function public.profile_owner(uuid)     to authenticated;
grant execute on function public.is_profile_member(uuid) to authenticated;
grant execute on function public.can_write_profile(uuid) to authenticated;

-- ── Owner owns everything ───────────────────────────────────
-- BEFORE INSERT OR UPDATE, so it runs ahead of the WITH CHECK below: that is what
-- makes a member's insert legal — they send their own user_id (or none), the trigger
-- rewrites it to the owner's, and only then is the row checked. Rows in Personal
-- (profile_id null) are left exactly as they are, which is today's behaviour.
--
-- The trigger also guards moves OUT of a shared profile, which RLS cannot: a WITH
-- CHECK only ever sees the new row, so it can't tell "member created this in Personal"
-- from "member just dragged the owner's row into their Personal list". Left open, a
-- member could relocate a shared task to profile_id null with user_id = self and walk
-- off with a private copy while the owner loses the row — worse than the delete they
-- are already allowed, and flatly against owner-owns-everything. So: once a row is in
-- a profile, only that profile's owner may change its profile_id. Moving a row INTO a
-- profile is untouched (old.profile_id is null there), so a member filing one of their
-- own Personal tasks into the shared list still works.
create or replace function public.stamp_profile_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is null only for a trusted server context (service role, SQL editor,
  -- the reminder cron) — never for a client, which RLS has already filtered by then.
  if tg_op = 'UPDATE'
     and old.profile_id is not null
     and new.profile_id is distinct from old.profile_id
     and auth.uid() is not null
     and auth.uid() <> public.profile_owner(old.profile_id) then
    raise exception 'Only the profile owner can move this out of a shared profile'
      using errcode = '42501';
  end if;

  if new.profile_id is not null then
    new.user_id := public.profile_owner(new.profile_id);
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_stamp_profile_owner on public.tasks;
create trigger tasks_stamp_profile_owner
  before insert or update on public.tasks
  for each row execute function public.stamp_profile_owner();

drop trigger if exists contexts_stamp_profile_owner on public.contexts;
create trigger contexts_stamp_profile_owner
  before insert or update on public.contexts
  for each row execute function public.stamp_profile_owner();

-- ── Row-Level Security ──────────────────────────────────────
-- This REPLACES the old "own profiles" / "own tasks" / "own contexts" policies.

alter table public.profiles        enable row level security;
alter table public.tasks           enable row level security;
alter table public.contexts        enable row level security;
alter table public.profile_members enable row level security;

-- profiles: members can see the profile they were let into (they need its name),
-- but rename, delete and re-sharing stay owner-only.
drop policy if exists "own profiles" on public.profiles;
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles
  for select
  using (user_id = auth.uid() or public.is_profile_member(id));

drop policy if exists "insert own profiles" on public.profiles;
create policy "insert own profiles" on public.profiles
  for insert
  with check (user_id = auth.uid());

drop policy if exists "update own profiles" on public.profiles;
create policy "update own profiles" on public.profiles
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "delete own profiles" on public.profiles;
create policy "delete own profiles" on public.profiles
  for delete
  using (user_id = auth.uid());

-- tasks + contexts: identical rules. USING covers read/update/delete of rows I own
-- (which includes every Personal row) plus rows in a profile I'm an accepted member
-- of. WITH CHECK covers what I may write: a Personal row must be mine and unshared;
-- anything with a profile_id must be a profile I can write, and the trigger above has
-- already rewritten user_id to that profile's owner by the time this runs.
drop policy if exists "own tasks" on public.tasks;
drop policy if exists "tasks in my profiles" on public.tasks;
create policy "tasks in my profiles" on public.tasks
  for all
  using (
    user_id = auth.uid()
    or (profile_id is not null and public.is_profile_member(profile_id))
  )
  with check (
    (profile_id is null and user_id = auth.uid())
    or public.can_write_profile(profile_id)
  );

drop policy if exists "own contexts" on public.contexts;
drop policy if exists "contexts in my profiles" on public.contexts;
create policy "contexts in my profiles" on public.contexts
  for all
  using (
    user_id = auth.uid()
    or (profile_id is not null and public.is_profile_member(profile_id))
  )
  with check (
    (profile_id is null and user_id = auth.uid())
    or public.can_write_profile(profile_id)
  );

-- profile_members: the owner sees the whole list; everybody else sees only their own
-- row. That asymmetry is the whole privacy story — it is what stops one member
-- reading another member's email address.
drop policy if exists "read profile members" on public.profile_members;
create policy "read profile members" on public.profile_members
  for select
  using (
    public.profile_owner(profile_id) = auth.uid()
    or user_id = auth.uid()
    or email = lower(auth.jwt() ->> 'email')
  );

-- Only the owner invites, and never themselves (they already have full access; a
-- self-invite would show up as a pending card in their own switcher). `is distinct
-- from`, not `<>`: a JWT carrying no email claim would make `<>` evaluate to NULL and
-- silently block every invite, so don't "simplify" this back.
drop policy if exists "owner invites members" on public.profile_members;
create policy "owner invites members" on public.profile_members
  for insert
  with check (
    public.profile_owner(profile_id) = auth.uid()
    and email is distinct from lower(auth.jwt() ->> 'email')
  );

-- One policy covers revoke, cancel-invite, reject and leave: the owner may delete any
-- row of their profile, and you may always delete your own row (matched by user_id
-- once accepted, by email while still pending).
drop policy if exists "remove profile members" on public.profile_members;
create policy "remove profile members" on public.profile_members
  for delete
  using (
    public.profile_owner(profile_id) = auth.uid()
    or user_id = auth.uid()
    or email = lower(auth.jwt() ->> 'email')
  );

-- Deliberately no UPDATE policy. Accepting is the only legal mutation and it goes
-- through the RPC below, so nobody can hand themselves an 'accepted' row directly.

-- ── Accept an invite ────────────────────────────────────────
-- SECURITY DEFINER because there is no UPDATE policy to satisfy. The match is on the
-- caller's JWT email, so an invite sent before the person had an account still works:
-- accepting is what binds the row to a user_id.
create or replace function public.accept_invite(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(auth.jwt() ->> 'email'));
  v_uid   uuid := auth.uid();
begin
  if v_uid is null or v_email is null or v_email = '' then
    raise exception 'not authenticated';
  end if;

  update public.profile_members
     set user_id     = v_uid,
         status      = 'accepted',
         accepted_at = now()
   where profile_id = p_profile_id
     and email      = v_email
     and status     = 'pending';

  if not found then
    raise exception 'no pending invite for this profile';
  end if;
end;
$$;

revoke all on function public.accept_invite(uuid) from public;
grant execute on function public.accept_invite(uuid) to authenticated;

-- ── Realtime ────────────────────────────────────────────────
-- Invites and revocations have to arrive live: a revoked member's device drops the
-- profile on the DELETE event, which REPLICA IDENTITY FULL makes carry the old row.
alter table public.profile_members replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profile_members'
  ) then
    alter publication supabase_realtime add table public.profile_members;
  end if;
end $$;

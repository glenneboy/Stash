import type { Context, Profile, ProfileMember, Task } from '../types';
import { isOwner, isShared } from './sharing';

// ── Default ("Personal") profile ─────────────────────────────
// The default profile is implicit: any task/context with a null (or absent)
// profile_id belongs to it. This is what makes the feature backwards compatible —
// every pre-existing row, and every row written by an older app version that knows
// nothing about profiles, maps to Default with no migration or backfill.
export const DEFAULT_PROFILE_ID = null;
export const DEFAULT_PROFILE_NAME = 'Personal';

// Normalize a row's profile, treating both null and undefined (old cached rows that
// predate the column) as the Default profile.
export function profileOf<T extends { profile_id?: string | null }>(row: T): string | null {
  return row.profile_id ?? null;
}

export function tasksForProfile(tasks: Task[], activeId: string | null): Task[] {
  return tasks.filter((t) => profileOf(t) === activeId);
}

export function contextsForProfile(contexts: Context[], activeId: string | null): Context[] {
  return contexts.filter((c) => profileOf(c) === activeId);
}

// Human-readable name for the active profile; falls back to the Default name for
// the null bucket and for ids that no longer resolve (e.g. just-deleted profile).
export function profileName(profiles: Profile[], activeId: string | null): string {
  if (activeId === null) return DEFAULT_PROFILE_NAME;
  return profiles.find((p) => p.id === activeId)?.name ?? DEFAULT_PROFILE_NAME;
}

// Resolve a profile id from a display name, case-insensitively, for the
// `?profile=<name>` deep link. Matches the Default profile's name too. Returns
// undefined (distinct from the valid null id) when nothing matches.
//
// A name collision (my own "Trip" vs one shared with me) prefers the profile I
// own — `userId` defaults to null so existing callers that don't pass it keep
// resolving to the first match, same as before sharing existed.
export function profileIdByName(
  profiles: Profile[],
  name: string,
  userId: string | null = null,
): string | null | undefined {
  const key = name.trim().toLowerCase();
  if (key === DEFAULT_PROFILE_NAME.toLowerCase()) return DEFAULT_PROFILE_ID;
  const matches = profiles.filter((p) => p.name.toLowerCase() === key);
  if (matches.length === 0) return undefined;
  return (matches.find((p) => isOwner(p, userId)) ?? matches[0]).id;
}

// A profile carries the shared badge either because I don't own it (someone
// shared it with me) or because I own it and at least one invite has been
// accepted — an owner sharing a profile sees it marked too.
export function isProfileShared(profile: Profile, members: ProfileMember[], userId: string | null): boolean {
  return !isOwner(profile, userId) || isShared(members, profile.id);
}

// ── Moving tasks between profiles ────────────────────────────
// Tags (contexts) are scoped to a profile, so a task's context ids only exist in
// the profile it currently lives in. When a task moves to another profile we
// re-point each of its tags at the matching tag (by name) in the destination, and
// where no match exists — a "missing context" — we plan a fresh copy to be created
// in the destination so the moved task keeps every tag it had.
export interface ContextMigration {
  // The task's remapped context ids, valid in the destination profile.
  contexts: string[];
  // Tags that don't yet exist in the destination and must be created there.
  created: Context[];
}

export function planContextMigration(
  taskContextIds: string[],
  allContexts: Context[],
  targetProfileId: string | null,
  makeContext: (name: string) => Context,
): ContextMigration {
  const byId = new Map(allContexts.map((c) => [c.id, c]));
  // Match tags by name (case-insensitively) so "Errands" in one profile reuses an
  // existing "errands" in the destination rather than spawning a duplicate.
  const targetByName = new Map(
    contextsForProfile(allContexts, targetProfileId).map((c) => [c.name.toLowerCase(), c.id]),
  );

  const created: Context[] = [];
  const contexts: string[] = [];
  for (const id of taskContextIds) {
    const source = byId.get(id);
    if (!source) continue; // dangling id (deleted tag) — nothing to carry over
    const key = source.name.toLowerCase();
    const existingId = targetByName.get(key);
    if (existingId) {
      if (!contexts.includes(existingId)) contexts.push(existingId);
      continue;
    }
    // Missing context: create it once in the destination, reusing it if the task
    // happens to carry two source tags that share a name.
    const fresh = makeContext(source.name);
    created.push(fresh);
    targetByName.set(key, fresh.id);
    contexts.push(fresh.id);
  }
  return { contexts, created };
}

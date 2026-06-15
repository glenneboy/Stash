import type { Context, Profile, Task } from '../types';

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

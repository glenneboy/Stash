import { describe, it, expect } from 'vitest';
import type { Context, Profile, Task } from '../types';
import {
  DEFAULT_PROFILE_NAME,
  contextsForProfile,
  planContextMigration,
  profileIdByName,
  profileName,
  profileOf,
  tasksForProfile,
} from './profiles';

function task(id: string, profile_id: string | null): Task {
  return {
    id,
    title: id,
    note: null,
    contexts: [],
    completed: false,
    created_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    due_on: null,
    reminder_at: null,
    notify_next_at: null,
    notify_stage: 0,
    profile_id,
  };
}

function context(id: string, profile_id: string | null): Context {
  return { id, name: id, created_at: '2026-01-01T00:00:00.000Z', profile_id };
}

describe('profileOf', () => {
  it('treats null as the Default profile', () => {
    expect(profileOf(task('a', null))).toBe(null);
  });

  it('treats a missing profile_id (old cached row) as the Default profile', () => {
    // Simulate a row persisted by a version that predates the column.
    const legacy = { id: 'legacy', title: 'x' } as unknown as Task;
    expect(profileOf(legacy)).toBe(null);
  });

  it('returns the id for a named profile', () => {
    expect(profileOf(task('a', 'work'))).toBe('work');
  });
});

describe('tasksForProfile', () => {
  const tasks: Task[] = [
    task('default-1', null),
    task('work-1', 'work'),
    task('work-2', 'work'),
    task('home-1', 'home'),
  ];

  it('Default view returns only null-profile tasks', () => {
    expect(tasksForProfile(tasks, null).map((t) => t.id)).toEqual(['default-1']);
  });

  it('named profiles return disjoint sets — Work and Home never bleed together', () => {
    const work = tasksForProfile(tasks, 'work').map((t) => t.id);
    const home = tasksForProfile(tasks, 'home').map((t) => t.id);
    expect(work).toEqual(['work-1', 'work-2']);
    expect(home).toEqual(['home-1']);
    expect(work.filter((id) => home.includes(id))).toEqual([]);
  });

  it('backwards compat: an old-client insert (no profile_id) shows under Default, not a named profile', () => {
    const legacy = { id: 'legacy', title: 'x' } as unknown as Task;
    const all = [...tasks, legacy];
    expect(tasksForProfile(all, null).map((t) => t.id)).toContain('legacy');
    expect(tasksForProfile(all, 'work').map((t) => t.id)).not.toContain('legacy');
  });
});

describe('contextsForProfile', () => {
  it('scopes tags to their profile, with null as Default', () => {
    const contexts: Context[] = [context('errand', null), context('standup', 'work')];
    expect(contextsForProfile(contexts, null).map((c) => c.id)).toEqual(['errand']);
    expect(contextsForProfile(contexts, 'work').map((c) => c.id)).toEqual(['standup']);
  });
});

describe('profileName', () => {
  const profiles: Profile[] = [{ id: 'work', name: 'Work', created_at: '2026-01-01T00:00:00.000Z' }];

  it('returns the Default name for the null bucket', () => {
    expect(profileName(profiles, null)).toBe(DEFAULT_PROFILE_NAME);
  });

  it('resolves a named profile', () => {
    expect(profileName(profiles, 'work')).toBe('Work');
  });

  it('falls back to the Default name for an unknown id (e.g. just-deleted profile)', () => {
    expect(profileName(profiles, 'ghost')).toBe(DEFAULT_PROFILE_NAME);
  });
});

describe('profileIdByName', () => {
  const profiles: Profile[] = [{ id: 'work-id', name: 'Work', created_at: '2026-01-01T00:00:00.000Z' }];

  it('resolves a named profile case-insensitively', () => {
    expect(profileIdByName(profiles, 'work')).toBe('work-id');
    expect(profileIdByName(profiles, 'WORK')).toBe('work-id');
  });

  it('resolves the Default profile name to null, case-insensitively', () => {
    expect(profileIdByName(profiles, 'Personal')).toBe(null);
    expect(profileIdByName(profiles, 'personal')).toBe(null);
  });

  it('returns undefined for a name that matches nothing', () => {
    expect(profileIdByName(profiles, 'ghost')).toBeUndefined();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(profileIdByName(profiles, '  Work  ')).toBe('work-id');
  });
});

describe('planContextMigration', () => {
  // Deterministic factory so created ids are easy to assert on.
  let n = 0;
  const makeContext = (name: string): Context => ({
    id: `new-${n++}`,
    name,
    created_at: '2026-01-01T00:00:00.000Z',
    profile_id: 'target',
  });

  it('re-points a tag at the destination tag with the same name (case-insensitive, no duplicate created)', () => {
    const all = [
      { ...context('src', 'work'), name: 'Errands' },
      { ...context('dst', 'target'), name: 'errands' },
    ];
    const { contexts, created } = planContextMigration(['src'], all, 'target', makeContext);
    expect(created).toEqual([]);
    expect(contexts).toEqual(['dst']);
  });

  it('creates a missing tag in the destination and points the task at the new copy', () => {
    const named = [{ ...context('src', 'work'), name: 'Standup' }];
    const { contexts, created } = planContextMigration(['src'], named, 'target', makeContext);
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('Standup');
    expect(created[0].profile_id).toBe('target');
    expect(contexts).toEqual([created[0].id]);
  });

  it('creates missing tags in the Default (null) profile too', () => {
    const named = [{ ...context('src', 'work'), name: 'Standup' }];
    const make = (name: string) => context(`d-${name}`, null);
    const { created } = planContextMigration(['src'], named, null, make);
    expect(created[0].profile_id).toBe(null);
  });

  it('drops dangling ids that no longer resolve to a tag', () => {
    const { contexts, created } = planContextMigration(['ghost'], [], 'target', makeContext);
    expect(contexts).toEqual([]);
    expect(created).toEqual([]);
  });

  it('reuses a single new tag (deduped) when the task carries two source tags of the same name', () => {
    const named = [
      { ...context('a', 'work'), name: 'Urgent' },
      { ...context('b', 'work'), name: 'urgent' },
    ];
    const { contexts, created } = planContextMigration(['a', 'b'], named, 'target', makeContext);
    expect(created).toHaveLength(1);
    expect(contexts).toEqual([created[0].id]);
  });
});

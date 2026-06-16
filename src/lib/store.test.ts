// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real supabase client throws at import without env vars and would make live
// network calls; mock it with a no-op chainable builder so the optimistic local
// store logic can be tested in isolation.
vi.mock('./supabase', () => {
  const ok = Promise.resolve({ data: [], error: null });
  const builder = {
    insert: () => ok,
    update: () => ({ eq: () => ok }),
    delete: () => ({ eq: () => ok }),
    select: () => ({ order: () => ok }),
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: () => builder,
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});

import {
  reset,
  getSnapshot,
  setActiveProfile,
  createTask,
  createContext,
  deleteProfile,
  moveTaskToProfile,
  runUndo,
} from './store';
import { contextsForProfile, tasksForProfile } from './profiles';

const ACTIVE_PROFILE_KEY = 'stash.activeProfile';

beforeEach(() => {
  localStorage.clear();
  reset();
});

describe('createTask', () => {
  it('stamps the new task with the active profile', () => {
    setActiveProfile('work');
    const id = createTask('ship it', []);
    const created = getSnapshot().tasks.find((t) => t.id === id);
    expect(created?.profile_id).toBe('work');
  });

  it('stamps null (Default) when no profile is active', () => {
    const id = createTask('buy milk', []);
    expect(getSnapshot().tasks.find((t) => t.id === id)?.profile_id).toBe(null);
  });
});

describe('setActiveProfile', () => {
  it('updates state and persists the per-device preference to localStorage', () => {
    setActiveProfile('home');
    expect(getSnapshot().activeProfileId).toBe('home');
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe(JSON.stringify('home'));
  });
});

describe('moveTaskToProfile', () => {
  it('moves the task into the target profile', () => {
    const id = createTask('write report', []);
    moveTaskToProfile(id, 'work');
    expect(getSnapshot().tasks.find((t) => t.id === id)?.profile_id).toBe('work');
  });

  it('is a no-op when the task is already in the target profile', () => {
    setActiveProfile('work');
    const id = createTask('already here', []);
    const before = getSnapshot().tasks;
    moveTaskToProfile(id, 'work');
    expect(getSnapshot().tasks).toBe(before);
  });

  it('re-points the moved task at the destination tag that shares a name', () => {
    // A "Errands" tag exists in both profiles.
    setActiveProfile(null);
    createContext('Errands');
    const defaultErrand = getSnapshot().contexts.find((c) => c.profile_id === null)!;
    setActiveProfile('work');
    createContext('Errands');
    const workErrand = getSnapshot().contexts.find((c) => c.profile_id === 'work')!;

    setActiveProfile(null);
    const id = createTask('buy stamps', [defaultErrand.id]);
    moveTaskToProfile(id, 'work');

    const moved = getSnapshot().tasks.find((t) => t.id === id)!;
    expect(moved.contexts).toEqual([workErrand.id]);
    // No duplicate tag was created in the destination.
    expect(contextsForProfile(getSnapshot().contexts, 'work')).toHaveLength(1);
  });

  it('creates a missing tag in the destination so the moved task keeps it', () => {
    setActiveProfile(null);
    createContext('Receipts');
    const receipts = getSnapshot().contexts.find((c) => c.profile_id === null)!;
    const id = createTask('file taxes', [receipts.id]);

    moveTaskToProfile(id, 'work');

    const workContexts = contextsForProfile(getSnapshot().contexts, 'work');
    expect(workContexts).toHaveLength(1);
    expect(workContexts[0].name).toBe('Receipts');
    const moved = getSnapshot().tasks.find((t) => t.id === id)!;
    expect(moved.contexts).toEqual([workContexts[0].id]);
  });

  it('undo restores the task to its original profile and tags', () => {
    setActiveProfile(null);
    createContext('Receipts');
    const receipts = getSnapshot().contexts.find((c) => c.profile_id === null)!;
    const id = createTask('file taxes', [receipts.id]);

    moveTaskToProfile(id, 'work');
    runUndo();

    const restored = getSnapshot().tasks.find((t) => t.id === id)!;
    expect(restored.profile_id).toBe(null);
    expect(restored.contexts).toEqual([receipts.id]);
    expect(tasksForProfile(getSnapshot().tasks, null).map((t) => t.id)).toContain(id);
  });
});

describe('deleteProfile', () => {
  it("removes the profile's tasks and contexts and falls back to Default when it was active", () => {
    setActiveProfile('work');
    createTask('work task', []);
    createContext('standup');
    // A task in another profile must survive.
    setActiveProfile(null);
    createTask('personal task', []);
    setActiveProfile('work');

    deleteProfile('work');

    const { tasks, contexts, activeProfileId } = getSnapshot();
    expect(tasks.some((t) => t.profile_id === 'work')).toBe(false);
    expect(tasks.some((t) => t.profile_id === null)).toBe(true);
    expect(contexts.some((c) => c.profile_id === 'work')).toBe(false);
    expect(activeProfileId).toBe(null);
  });
});

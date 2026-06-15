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
} from './store';

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

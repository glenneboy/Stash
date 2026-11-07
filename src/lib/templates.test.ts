import { describe, it, expect } from 'vitest';
import { TEMPLATES, buildTemplate } from './templates';

describe('buildTemplate', () => {
  const built = buildTemplate(TEMPLATES.umrah, 'u1', new Date('2026-01-01T00:00:00Z'));

  it('puts everything in one new profile', () => {
    expect(built.profile.name).toBe('Umrah');
    expect(built.contexts.every((c) => c.profile_id === built.profile.id)).toBe(true);
    expect(built.tasks.every((t) => t.profile_id === built.profile.id)).toBe(true);
  });

  it('tags each task with exactly one existing context', () => {
    const ids = new Set(built.contexts.map((c) => c.id));
    expect(built.tasks.every((t) => t.contexts.length === 1 && ids.has(t.contexts[0]))).toBe(true);
  });

  it('keeps reading order when sorted newest-first', () => {
    const sorted = [...built.tasks].sort((a, b) => b.created_at.localeCompare(a.created_at));
    expect(sorted.map((t) => t.id)).toEqual(built.tasks.map((t) => t.id));
  });
});

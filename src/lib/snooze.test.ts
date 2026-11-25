import { describe, expect, it } from 'vitest';
import { snoozeDay, snoozePatch } from './snooze';
import type { Task } from '../types';

// Wednesday, 1 July 2026, 10:07 local.
const wed = new Date(2026, 6, 1, 10, 7);
const task = (over: Partial<Task> = {}): Task => ({
  id: 't', title: 'x', note: null, contexts: [], completed: false, created_at: '', completed_at: null,
  due_on: '2026-07-01', reminder_at: null, notify_next_at: null, notify_stage: 2, recur: null, profile_id: null,
  ...over,
});

describe('snoozeDay', () => {
  it('resolves the fixed targets', () => {
    expect(snoozeDay({ kind: 'tomorrow' }, wed)).toBe('2026-07-02');
    expect(snoozeDay({ kind: 'weekend' }, wed)).toBe('2026-07-04');
    expect(snoozeDay({ kind: 'nextweek' }, wed)).toBe('2026-07-06');
    expect(snoozeDay({ kind: 'date', dueOn: '2026-08-01' }, wed)).toBe('2026-08-01');
  });

  it('weekend on a Saturday or Sunday means the following Saturday', () => {
    expect(snoozeDay({ kind: 'weekend' }, new Date(2026, 6, 4, 9))).toBe('2026-07-11');
    expect(snoozeDay({ kind: 'weekend' }, new Date(2026, 6, 5, 9))).toBe('2026-07-11');
  });

  it('next week on a Monday means the following Monday', () => {
    expect(snoozeDay({ kind: 'nextweek' }, new Date(2026, 6, 6, 9))).toBe('2026-07-13');
  });
});

describe('snoozePatch', () => {
  it('later today sets a rounded reminder three hours out', () => {
    const p = snoozePatch(task(), { kind: 'later' }, wed);
    const r = new Date(p.reminder_at!);
    expect([r.getHours(), r.getMinutes()]).toEqual([13, 15]);
    expect(p.due_on).toBe('2026-07-01');
    expect(p.notify_next_at).toBe(p.reminder_at);
    expect(p.notify_stage).toBe(0);
  });

  it('keeps no reminder when the task had none', () => {
    expect(snoozePatch(task(), { kind: 'tomorrow' }, wed)).toMatchObject({ due_on: '2026-07-02', reminder_at: null });
  });

  it('moves an existing reminder to the new day at the same time', () => {
    const p = snoozePatch(task({ reminder_at: new Date(2026, 6, 1, 18, 30).toISOString() }), { kind: 'nextweek' }, wed);
    const r = new Date(p.reminder_at!);
    expect([r.getDate(), r.getHours(), r.getMinutes()]).toEqual([6, 18, 30]);
  });
});

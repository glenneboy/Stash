import { describe, expect, it } from 'vitest';
import { nextDueOn, nextOccurrence, recurLabel } from './recur';
import type { Recurrence, Task } from '../types';

// Wednesday, 1 July 2026.
const today = new Date(2026, 6, 1, 15, 0);

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Bins out',
    note: null,
    contexts: [],
    completed: false,
    created_at: '2026-06-01T00:00:00.000Z',
    completed_at: null,
    due_on: null,
    reminder_at: null,
    notify_next_at: null,
    notify_stage: 0,
    recur: null,
    profile_id: null,
    ...overrides,
  };
}

describe('nextDueOn', () => {
  const weekly: Recurrence = { unit: 'week', interval: 1 };

  it('advances a due date by the rule', () => {
    expect(nextDueOn(weekly, '2026-07-01', today)).toBe('2026-07-08');
    expect(nextDueOn({ unit: 'day', interval: 1 }, '2026-07-01', today)).toBe('2026-07-02');
    expect(nextDueOn({ unit: 'month', interval: 1 }, '2026-07-01', today)).toBe('2026-08-01');
  });

  it('supports custom intervals', () => {
    expect(nextDueOn({ unit: 'week', interval: 2 }, '2026-07-01', today)).toBe('2026-07-15');
    expect(nextDueOn({ unit: 'day', interval: 90 }, '2026-07-01', today)).toBe('2026-09-29');
  });

  it('stays anchored to the schedule when completed late', () => {
    // Bin day was Monday 29 June, ticked off on Wednesday: next is Monday 6 July.
    expect(nextDueOn(weekly, '2026-06-29', today)).toBe('2026-07-06');
  });

  it('skips missed occurrences on long-overdue tasks', () => {
    expect(nextDueOn(weekly, '2026-05-06', today)).toBe('2026-07-08');
  });

  it('never lands on or before today', () => {
    // Due today, daily: tomorrow, not today again.
    expect(nextDueOn({ unit: 'day', interval: 1 }, '2026-07-01', today)).toBe('2026-07-02');
  });

  it('recurs from today when the task has no due date', () => {
    expect(nextDueOn(weekly, null, today)).toBe('2026-07-08');
  });

  it('clamps month-end dates', () => {
    expect(nextDueOn({ unit: 'month', interval: 1 }, '2027-01-31', new Date(2027, 0, 31))).toBe('2027-02-28');
  });
});

describe('nextOccurrence', () => {
  it('spawns an uncompleted copy with the advanced due date', () => {
    const t = task({ completed: true, due_on: '2026-07-01', recur: { unit: 'week', interval: 1 } });
    const next = nextOccurrence(t, 'n1', today);
    expect(next).toMatchObject({
      id: 'n1',
      title: 'Bins out',
      completed: false,
      completed_at: null,
      due_on: '2026-07-08',
      recur: { unit: 'week', interval: 1 },
    });
  });

  it('shifts a reminder by the same number of days as the due date', () => {
    const t = task({
      due_on: '2026-07-01',
      reminder_at: '2026-06-30T18:00:00.000Z', // 7pm the night before
      recur: { unit: 'week', interval: 1 },
    });
    const next = nextOccurrence(t, 'n1', today);
    expect(next.reminder_at).toBe('2026-07-07T18:00:00.000Z');
    expect(next.notify_next_at).toBe('2026-07-07T18:00:00.000Z');
    expect(next.notify_stage).toBe(0);
  });

  it('drops the reminder when the task has no due date to anchor the shift', () => {
    const t = task({ reminder_at: '2026-06-30T18:00:00.000Z', recur: { unit: 'day', interval: 1 } });
    const next = nextOccurrence(t, 'n1', today);
    expect(next.reminder_at).toBeNull();
    expect(next.notify_next_at).toBeNull();
  });
});

describe('recurLabel', () => {
  it('labels presets and custom intervals', () => {
    expect(recurLabel({ unit: 'day', interval: 1 })).toBe('Daily');
    expect(recurLabel({ unit: 'week', interval: 1 })).toBe('Weekly');
    expect(recurLabel({ unit: 'month', interval: 1 })).toBe('Monthly');
    expect(recurLabel({ unit: 'week', interval: 2 })).toBe('Every 2 weeks');
  });
});

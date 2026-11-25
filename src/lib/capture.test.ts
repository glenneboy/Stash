import { describe, expect, it } from 'vitest';
import { parseCapture, splitPastedLines } from './capture';
import type { Context } from '../types';

// Wednesday, 1 July 2026, 10:00 local.
const ref = new Date(2026, 6, 1, 10, 0);
const ctx = (id: string, name: string): Context => ({ id, name, created_at: '', profile_id: null });
const contexts = [ctx('h', 'Home'), ctx('w', 'Work')];
const local = (iso: string | null) => (iso ? new Date(iso) : null);

describe('parseCapture', () => {
  it('handles date, time and tag together', () => {
    const c = parseCapture('Call dentist tomorrow 3pm #Home', contexts, ref);
    expect(c.title).toBe('Call dentist');
    expect(c.tagIds).toEqual(['h']);
    expect(c.dueOn).toBe('2026-07-02');
    const r = local(c.reminderAt)!;
    expect([r.getDate(), r.getHours(), r.getMinutes()]).toEqual([2, 15, 0]);
    expect(c.recur).toBeNull();
  });

  it('turns a bare clock time into a reminder today', () => {
    const c = parseCapture('Ring Sam at 4pm', contexts, ref);
    expect(c.title).toBe('Ring Sam');
    expect(c.dueOn).toBe('2026-07-01');
    expect(local(c.reminderAt)!.getHours()).toBe(16);
  });

  it('rolls a time that has already passed to tomorrow', () => {
    const c = parseCapture('Stretch 9am', contexts, ref);
    expect(c.dueOn).toBe('2026-07-02');
  });

  it('ignores bare numbers that are not times', () => {
    const c = parseCapture('Buy 2 lemons', contexts, ref);
    expect(c.title).toBe('Buy 2 lemons');
    expect(c.dueOn).toBeNull();
    expect(c.reminderAt).toBeNull();
  });

  it('keeps a date-only phrase as a due date with no reminder', () => {
    const c = parseCapture('MOT booking Friday', contexts, ref);
    expect(c).toMatchObject({ title: 'MOT booking', dueOn: '2026-07-03', reminderAt: null });
  });

  it('parses "every Monday" as weekly from next Monday', () => {
    const c = parseCapture('Bins out every Monday', contexts, ref);
    expect(c.title).toBe('Bins out');
    expect(c.recur).toEqual({ unit: 'week', interval: 1 });
    expect(c.dueOn).toBe('2026-07-06');
  });

  it('parses interval repeats and starts them today', () => {
    expect(parseCapture('Water plants every 3 days', contexts, ref)).toMatchObject({
      title: 'Water plants',
      recur: { unit: 'day', interval: 3 },
      dueOn: '2026-07-01',
    });
    expect(parseCapture('Review budget monthly', contexts, ref).recur).toEqual({ unit: 'month', interval: 1 });
    expect(parseCapture('Lube chain every other week', contexts, ref).recur).toEqual({ unit: 'week', interval: 2 });
    expect(parseCapture('Take pill daily 8pm', contexts, ref)).toMatchObject({
      title: 'Take pill',
      recur: { unit: 'day', interval: 1 },
      dueOn: '2026-07-01',
    });
  });

  it('skipped pieces stay in the title', () => {
    const c = parseCapture('Call dentist tomorrow #Home', contexts, ref, { when: true, tags: ['h'] });
    expect(c.title).toBe('Call dentist tomorrow #Home');
    expect(c.dueOn).toBeNull();
    expect(c.tagIds).toEqual([]);
    expect(c.found.when).toBe(true);

    const r = parseCapture('Standup every day', contexts, ref, { recur: true });
    expect(r.recur).toBeNull();
    expect(r.title).toBe('Standup every day');
  });

  it('never strips the whole title', () => {
    expect(parseCapture('Friday', contexts, ref).title).toBe('Friday');
  });
});

describe('splitPastedLines', () => {
  it('drops list markers and blank lines', () => {
    expect(splitPastedLines('- milk\n* eggs\n\n1. bread\n- [ ] butter\n• jam\r\n[x] tea')).toEqual([
      'milk',
      'eggs',
      'bread',
      'butter',
      'jam',
      'tea',
    ]);
  });
});

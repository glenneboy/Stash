import type { Task } from '../types';
import { toDayString } from './recur';

// Snoozing pushes a task to a later day (and, if it has a reminder, moves the
// reminder with it, keeping its time of day). "Later today" and "In an hour"
// always set a reminder, since a due date alone can't say "later today".

export type SnoozeTarget =
  | { kind: 'hour' }
  | { kind: 'later' }
  | { kind: 'tomorrow' }
  | { kind: 'weekend' }
  | { kind: 'nextweek' }
  | { kind: 'date'; dueOn: string };

export type SnoozePatch = Pick<Task, 'due_on' | 'reminder_at' | 'notify_next_at' | 'notify_stage'>;

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fromDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** now + hours, rounded up to the next quarter hour. */
function laterBy(now: Date, hours: number): Date {
  const t = new Date(now.getTime() + hours * 3_600_000);
  const q = 15 * 60_000;
  return new Date(Math.ceil(t.getTime() / q) * q);
}

/** The calendar day a target lands on. */
export function snoozeDay(target: SnoozeTarget, now: Date = new Date()): string {
  switch (target.kind) {
    case 'hour':
      return toDayString(laterBy(now, 1));
    case 'later':
      return toDayString(laterBy(now, 3));
    case 'tomorrow':
      return toDayString(addDays(now, 1));
    case 'weekend': {
      // The coming Saturday; on a weekend, the next one.
      const dow = now.getDay(); // 0 Sun … 6 Sat
      const ahead = dow === 6 ? 7 : (6 - dow + 7) % 7 || 7;
      return toDayString(addDays(now, ahead));
    }
    case 'nextweek': {
      const dow = now.getDay();
      const ahead = ((1 - dow + 7) % 7) || 7;
      return toDayString(addDays(now, ahead));
    }
    case 'date':
      return target.dueOn;
  }
}

/** "Later today" only makes sense while there's a reasonable chunk of today left. */
export function laterTodayAvailable(now: Date = new Date()): boolean {
  return now.getHours() < 21;
}

export function snoozePatch(task: Task, target: SnoozeTarget, now: Date = new Date()): SnoozePatch {
  let reminder: Date | null = null;
  if (target.kind === 'hour') reminder = laterBy(now, 1);
  else if (target.kind === 'later') reminder = laterBy(now, 3);
  else if (task.reminder_at) {
    // Same time of day as the existing reminder, on the new day.
    const old = new Date(task.reminder_at);
    reminder = fromDay(snoozeDay(target, now));
    reminder.setHours(old.getHours(), old.getMinutes(), 0, 0);
  }
  const reminderAt = reminder ? reminder.toISOString() : null;
  return {
    due_on: snoozeDay(target, now),
    reminder_at: reminderAt,
    notify_next_at: reminderAt,
    notify_stage: 0,
  };
}

/** Short day label for the snooze sheet / toast: "Today", "Tomorrow", "Sat 28 Nov". */
export function dayLabel(day: string, now: Date = new Date()): string {
  if (day === toDayString(now)) return 'Today';
  if (day === toDayString(addDays(now, 1))) return 'Tomorrow';
  return fromDay(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

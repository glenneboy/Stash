import type { Recurrence, Task } from '../types';

// Recurring tasks: a rule stored on the task ("every 1 week"). Completing a
// recurring task spawns the next occurrence rather than un-checking later —
// bin day, chain lube, Zakat reminders.

/** `YYYY-MM-DD` for a local calendar day. */
export function toDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromDayString(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Advance a date by one rule step. Month steps clamp to the last day of the
// target month (Jan 31 + 1 month → Feb 28/29) instead of spilling into March.
function step(d: Date, rule: Recurrence): Date {
  const next = new Date(d);
  switch (rule.unit) {
    case 'day':
      next.setDate(next.getDate() + rule.interval);
      break;
    case 'week':
      next.setDate(next.getDate() + rule.interval * 7);
      break;
    case 'month': {
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + rule.interval);
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, lastDay));
      break;
    }
  }
  return next;
}

/**
 * The due date of the next occurrence. Anchored to the schedule (the current
 * due_on) rather than the completion moment, so weekly bin day stays on bin
 * day even when ticked off a day late. Steps repeat until the result lands
 * strictly after `today` — completing a long-overdue task skips the missed
 * occurrences instead of spawning one that is already overdue. A task with no
 * due date recurs from today.
 */
export function nextDueOn(rule: Recurrence, dueOn: string | null, today: Date = new Date()): string {
  const todayStr = toDayString(today);
  let d = dueOn ? fromDayString(dueOn) : fromDayString(todayStr);
  do {
    d = step(d, rule);
  } while (toDayString(d) <= todayStr);
  return toDayString(d);
}

// Build the next occurrence spawned when a recurring task is completed.
// Carries title/note/tags/profile and the rule itself; a reminder shifts by
// the same number of days the due date moved so "remind me at 7pm the night
// before" keeps working. Nudge scheduling restarts at stage 0.
export function nextOccurrence(task: Task, id: string, now: Date = new Date()): Task {
  if (!task.recur) throw new Error('nextOccurrence called on a non-recurring task');
  const due = nextDueOn(task.recur, task.due_on, now);

  let reminderAt: string | null = null;
  if (task.reminder_at && task.due_on) {
    const shiftDays =
      (fromDayString(due).getTime() - fromDayString(task.due_on).getTime()) / 86_400_000;
    const r = new Date(task.reminder_at);
    r.setDate(r.getDate() + Math.round(shiftDays));
    reminderAt = r.toISOString();
  }

  return {
    ...task,
    id,
    completed: false,
    created_at: now.toISOString(),
    completed_at: null,
    due_on: due,
    reminder_at: reminderAt,
    notify_next_at: reminderAt,
    notify_stage: 0,
  };
}

const UNIT_LABEL = { day: 'day', week: 'week', month: 'month' } as const;

/** Human label for a rule: "Daily", "Weekly", "Monthly", "Every 3 weeks". */
export function recurLabel(rule: Recurrence): string {
  if (rule.interval === 1) {
    return { day: 'Daily', week: 'Weekly', month: 'Monthly' }[rule.unit];
  }
  return `Every ${rule.interval} ${UNIT_LABEL[rule.unit]}s`;
}

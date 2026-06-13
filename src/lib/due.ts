import type { Task } from '../types';

// A due date is a calendar day (`YYYY-MM-DD`), not an instant — urgency is measured
// in whole days from today, independent of the time of day or the user's timezone.

export type DueTier = 'overdue' | 'today' | 'soon' | 'later';

export interface DueInfo {
  label: string;
  tier: DueTier;
  className: string;
  alert: boolean; // show an exclamation icon (vs a small dot) — the deadline is here/past
}

const DAY = 86_400_000;

// Whole-day difference between today and the due date, both at local midnight so the
// result is exact (negative = overdue, 0 = today, positive = upcoming).
export function daysUntilDue(dueOn: string): number {
  const [y, m, d] = dueOn.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / DAY);
}

// Far-off dates read as an absolute date ("Jun 25", with the year only when it differs).
function absolute(dueOn: string): string {
  const [y, m, d] = dueOn.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const opts: Intl.DateTimeFormatOptions =
    y === new Date().getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString(undefined, opts);
}

// Human label + urgency styling for a task's due date, or null when none is set.
// Within a week reads relative ("Tomorrow", "In 5 days"); further out reads as a date.
// Completed tasks are shown neutrally — the deadline no longer matters.
export function dueInfo(task: Task): DueInfo | null {
  if (!task.due_on) return null;
  const days = daysUntilDue(task.due_on);

  let tier: DueTier;
  let label: string;
  if (days < 0) {
    tier = 'overdue';
    label = days === -1 ? 'Yesterday' : `${-days} days ago`;
  } else if (days === 0) {
    tier = 'today';
    label = 'Today';
  } else if (days === 1) {
    tier = 'soon';
    label = 'Tomorrow';
  } else if (days <= 7) {
    tier = 'soon';
    label = `In ${days} days`;
  } else {
    tier = 'later';
    label = absolute(task.due_on);
  }

  if (task.completed) {
    return { label, tier, className: 'text-muted', alert: false };
  }

  const className: Record<DueTier, string> = {
    overdue: 'text-red-500',
    today: 'text-amber-400',
    soon: 'text-amber-400',
    later: 'text-muted',
  };

  return { label, tier, className: className[tier], alert: tier === 'overdue' || tier === 'today' };
}

import type { Task } from '../types';

// A task with an active (uncompleted) reminder.
export function hasReminder(task: Task): boolean {
  return task.reminder_at !== null && !task.completed;
}

// Reminder time has passed and the task is still open.
export function isOverdue(task: Task): boolean {
  return hasReminder(task) && new Date(task.reminder_at as string).getTime() <= Date.now();
}

// ISO (UTC) → value for <input type="datetime-local"> in the user's local time.
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local value (local wall-clock) → absolute ISO (UTC) instant.
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

// Short weekday (e.g. "Sat") for a datetime-local value (`YYYY-MM-DDTHH:MM`). The
// native OS spinner only shows day/month/year, so this sits beside the input to say
// at a glance whether you've landed on a weekday or the weekend. Empty input → ''.
export function reminderWeekday(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

// Short weekday (e.g. "Sat") for a date-only value (`YYYY-MM-DD`). Parsed from its
// parts (not `new Date(value)`, which would read it as UTC midnight and can slip a day).
export function dueWeekday(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
}

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

// A datetime-local value (`YYYY-MM-DDTHH:MM`) spelled out with its weekday, so the
// native OS spinner — which only shows day/month/year — doesn't leave you guessing
// whether you've landed on a weekday or the weekend. Empty input → ''.
export function reminderLabel(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// A date-only value (`YYYY-MM-DD`) spelled out with its weekday. Parsed from its parts
// (not `new Date(value)`, which would read it as UTC midnight and can slip a day).
export function dueLabel(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

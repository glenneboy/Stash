import type { Task } from '../types';

export type DateDisplay = 'due' | 'age';

export interface AgeInfo {
  label: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 86_400_000;

// Human "time since creation" label with smart wording, e.g. "42s", "5 min",
// "2 hours", "1 day", "3 months", "2 years". `now` defaults to Date.now() but
// can be passed explicitly (tests, the live tick). Elapsed time is clamped to
// 0 so a clock-skewed created_at in the future never shows negative.
export function ageInfo(task: Task, now: number = Date.now()): AgeInfo {
  const createdAt = new Date(task.created_at).getTime();
  const ms = Math.max(0, now - createdAt);

  if (ms < MINUTE) return { label: `${Math.floor(ms / SECOND)}s` };

  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 60) return { label: `${minutes} min` };

  const hours = Math.floor(ms / HOUR);
  if (hours < 24) return { label: `${hours} hour${hours === 1 ? '' : 's'}` };

  const days = Math.floor(ms / DAY);
  if (days < 30) return { label: `${days} day${days === 1 ? '' : 's'}` };

  if (days < 365) {
    const months = Math.floor(days / 30);
    return { label: `${months} month${months === 1 ? '' : 's'}` };
  }

  const years = Math.floor(days / 365);
  return { label: `${years} year${years === 1 ? '' : 's'}` };
}

// Whether a task is still inside the sub-60s live-tick window — used to decide
// whether to run a per-second timer at all.
export function isWithinLiveTickWindow(task: Task, now: number = Date.now()): boolean {
  const ms = now - new Date(task.created_at).getTime();
  return ms >= 0 && ms < MINUTE;
}

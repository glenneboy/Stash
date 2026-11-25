import * as chrono from 'chrono-node';
import type { Context, Recurrence } from '../types';
import { parseTags } from './tags';
import { toDayString } from './recur';

// Everything the capture bar understands in one line of text:
//   "Call dentist tomorrow 3pm #Home"   → due tomorrow, reminder 3pm, tagged Home
//   "Bins out every Monday"             → due next Monday, repeats weekly
//   "Water plants every 3 days"         → due today, repeats every 3 days
// The recognised phrases are stripped from the title. Each piece can be skipped
// (the user tapped its chip away), in which case its text stays in the title.

export interface CaptureSkip {
  /** Ignore the date/time phrase. */
  when?: boolean;
  /** Ignore the repeat phrase. */
  recur?: boolean;
  /** Tag ids whose `#tag` tokens should stay literal text. */
  tags?: string[];
}

export interface Capture {
  title: string;
  tagIds: string[];
  /** `YYYY-MM-DD` local day. */
  dueOn: string | null;
  /** Absolute ISO instant, set when a clock time was given ("3pm", "15:30"). */
  reminderAt: string | null;
  recur: Recurrence | null;
  /** Whether a date/time phrase or a repeat phrase was found (even if skipped), so chips can show. */
  found: { when: boolean; recur: boolean };
}

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, other: 2 };
const WEEKDAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun';

const RECUR_PATTERNS: { re: RegExp; rule: (m: RegExpMatchArray) => Recurrence; keep?: (m: RegExpMatchArray) => string }[] = [
  { re: /\b(?:daily|every\s*day)\b/i, rule: () => ({ unit: 'day', interval: 1 }) },
  { re: /\bweekly\b/i, rule: () => ({ unit: 'week', interval: 1 }) },
  { re: /\bfortnightly\b/i, rule: () => ({ unit: 'week', interval: 2 }) },
  { re: /\bmonthly\b/i, rule: () => ({ unit: 'month', interval: 1 }) },
  { re: /\b(?:yearly|annually)\b/i, rule: () => ({ unit: 'month', interval: 12 }) },
  {
    // "every Monday" → weekly, and "Monday" is handed back for the date parser.
    re: new RegExp(`\\b(?:every|each)\\s+(${WEEKDAYS})s?\\b`, 'i'),
    rule: () => ({ unit: 'week', interval: 1 }),
    keep: (m) => m[1],
  },
  {
    re: /\b(?:every|each)\s+(\d+|one|two|three|four|five|six|other)?\s*(day|week|month|year)s?\b/i,
    rule: (m) => {
      const n = m[1] ? Number(m[1]) || NUMBERS[m[1].toLowerCase()] || 1 : 1;
      const unit = m[2].toLowerCase();
      if (unit === 'year') return { unit: 'month', interval: 12 * n };
      return { unit: unit as Recurrence['unit'], interval: Math.max(1, n) };
    },
  },
];

function tidy(s: string): string {
  return s.replace(/\s{2,}/g, ' ').trim();
}

function findRecur(text: string): { text: string; recur: Recurrence } | null {
  for (const p of RECUR_PATTERNS) {
    const m = text.match(p.re);
    if (!m || m.index === undefined) continue;
    const replacement = p.keep ? p.keep(m) : '';
    const rest = text.slice(0, m.index) + replacement + text.slice(m.index + m[0].length);
    return { text: tidy(rest), recur: p.rule(m) };
  }
  return null;
}

// A phrase that names a clock time explicitly. Bare numbers ("at 4", "buy 2 lemons")
// are too ambiguous to turn into a reminder.
const EXPLICIT_TIME = /\d\s*(?:am|pm|a\.m\.|p\.m\.)\b|\d{1,2}:\d{2}|\bnoon\b|\bmidday\b|\bmidnight\b/i;
const CONNECTIVE = /(?:\b(?:on|by|due|before|at)\s+)$/i;

function findWhen(text: string, ref: Date): { text: string; dueOn: string; reminderAt: string | null } | null {
  const results = chrono.parse(text, ref, { forwardDate: true });
  // Dates usually trail the task text; prefer the last confident match.
  const r = [...results].reverse().find((x) => {
    const hasDay = x.start.isCertain('day') || x.start.isCertain('weekday');
    const hasTime = x.start.isCertain('hour') && EXPLICIT_TIME.test(x.text);
    return hasDay || hasTime;
  });
  if (!r) return null;

  const hasTime = r.start.isCertain('hour') && EXPLICIT_TIME.test(r.text);
  let at = r.start.date();
  // A time with no day ("3pm") that has already passed today means tomorrow.
  const hasDay = r.start.isCertain('day') || r.start.isCertain('weekday');
  if (hasTime && !hasDay && at.getTime() <= ref.getTime()) {
    at = new Date(at);
    at.setDate(at.getDate() + 1);
  }

  const before = text.slice(0, r.index).replace(CONNECTIVE, '');
  const after = text.slice(r.index + r.text.length);
  return {
    text: tidy(`${before} ${after}`),
    dueOn: toDayString(at),
    reminderAt: hasTime ? at.toISOString() : null,
  };
}

export function parseCapture(input: string, contexts: Context[], ref: Date = new Date(), skip: CaptureSkip = {}): Capture {
  const skipTags = new Set(skip.tags ?? []);
  // Strip only the tags still wanted, so skipped ones stay literal.
  const kept = contexts.filter((c) => !skipTags.has(c.id));
  const { title: afterTags, tagIds } = parseTags(input, kept);

  let text = afterTags;
  let recur: Recurrence | null = null;
  const recurFound = findRecur(text);
  if (recurFound && !skip.recur) {
    text = recurFound.text;
    recur = recurFound.recur;
  }

  let dueOn: string | null = null;
  let reminderAt: string | null = null;
  const when = findWhen(text, ref);
  if (when && !skip.when) {
    // Never let the date phrase eat the whole title ("Friday" alone stays a title).
    if (when.text) {
      text = when.text;
      dueOn = when.dueOn;
      reminderAt = when.reminderAt;
    }
  }

  // A repeating task with no date starts today.
  if (recur && !dueOn) dueOn = toDayString(ref);

  return {
    title: text || afterTags || input.trim(),
    tagIds,
    dueOn,
    reminderAt,
    recur,
    found: { when: Boolean(when?.text), recur: Boolean(recurFound) },
  };
}

/** Tag ids recognised in the text, including skipped ones — for rendering chips. */
export function recognisedTags(input: string, contexts: Context[]): string[] {
  return parseTags(input, contexts).tagIds;
}

/**
 * Split pasted text into separate task lines, dropping list markers
 * ("- ", "* ", "• ", "1. ", "[ ] ", "- [x] ") and blank lines.
 */
export function splitPastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]\s+)?(?:\d+[.)]\s+)?(?:\[[ xX]?\]\s+)?/, '').trim())
    .filter(Boolean);
}

/** Short label for a chip: "Today 3:00 pm", "Tomorrow", "Mon 30 Nov 9:00 am". */
export function whenLabel(dueOn: string, reminderAt: string | null, ref: Date = new Date()): string {
  const today = toDayString(ref);
  const t = new Date(ref);
  t.setDate(t.getDate() + 1);
  const tomorrow = toDayString(t);
  const [y, m, d] = dueOn.split('-').map(Number);
  const day =
    dueOn === today
      ? 'Today'
      : dueOn === tomorrow
        ? 'Tomorrow'
        : new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (!reminderAt) return day;
  const time = new Date(reminderAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

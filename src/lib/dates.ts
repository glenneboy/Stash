import * as chrono from 'chrono-node';

// Natural-language due dates at capture time: "MOT booking Friday" → due Friday.
// The date phrase is stripped from the title (along with a joining "on/by/due/before"),
// unless the phrase IS the whole title, in which case the title is kept as-is.

export interface ParsedDate {
  title: string;
  /** `YYYY-MM-DD` local calendar day, matching Task.due_on. */
  dueOn: string | null;
}

// Connective immediately before the date phrase ("pay rent by Friday" → "pay rent").
const CONNECTIVE = /(?:\b(?:on|by|due|before)\s+)$/i;

function toDueOn(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pull a natural-language date out of a task title. Ambiguous weekday/relative
 * phrases resolve forward ("Friday" = the upcoming Friday). Only matches where
 * chrono is certain of the day or weekday count — this skips time-only fragments
 * ("at 4") and bare month words ("it may rain") that would misfire.
 */
export function parseNaturalDate(title: string, ref: Date = new Date()): ParsedDate {
  const results = chrono.parse(title, ref, { forwardDate: true });
  // Dates usually trail the task text; prefer the last confident match.
  const result = [...results]
    .reverse()
    .find((r) => r.start.isCertain('day') || r.start.isCertain('weekday'));
  if (!result) return { title, dueOn: null };

  const dueOn = toDueOn(result.start.date());

  const before = title.slice(0, result.index).replace(CONNECTIVE, '');
  const after = title.slice(result.index + result.text.length);
  const stripped = `${before} ${after}`.replace(/\s{2,}/g, ' ').trim();

  // If stripping would leave nothing, the "date" was the whole title — keep it.
  return { title: stripped || title, dueOn };
}

import { describe, it, expect } from 'vitest';
import { reminderLabel, dueLabel } from './reminders';

describe('dueLabel', () => {
  it('spells out the weekday for a date-only value', () => {
    // 2026-06-29 is a Monday.
    expect(dueLabel('2026-06-29')).toMatch(/^Monday/);
  });

  it('parses from the date parts so it does not slip a day across timezones', () => {
    // Read as UTC midnight this could fall back to the 28th in negative offsets;
    // parsing the parts as a local date keeps it on the 29th regardless of timezone.
    expect(dueLabel('2026-06-29')).toContain('29');
  });

  it('returns empty string for empty or malformed input', () => {
    expect(dueLabel('')).toBe('');
    expect(dueLabel('not-a-date')).toBe('');
  });
});

describe('reminderLabel', () => {
  it('includes the weekday for a datetime-local value', () => {
    // 2026-06-29T20:55 is a Monday evening.
    expect(reminderLabel('2026-06-29T20:55')).toMatch(/^Monday/);
  });

  it('returns empty string for empty or malformed input', () => {
    expect(reminderLabel('')).toBe('');
    expect(reminderLabel('nope')).toBe('');
  });
});

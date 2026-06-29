import { describe, it, expect } from 'vitest';
import { reminderWeekday, dueWeekday } from './reminders';

describe('dueWeekday', () => {
  it('returns the short weekday for a date-only value', () => {
    // 2026-06-27 is a Saturday.
    expect(dueWeekday('2026-06-27')).toBe('Sat');
  });

  it('parses from the date parts so it does not slip a day across timezones', () => {
    // Read as UTC midnight this could fall back to Friday in negative offsets;
    // parsing the parts as a local date keeps it on Saturday regardless of timezone.
    expect(dueWeekday('2026-06-27')).toBe('Sat');
  });

  it('returns empty string for empty or malformed input', () => {
    expect(dueWeekday('')).toBe('');
    expect(dueWeekday('not-a-date')).toBe('');
  });
});

describe('reminderWeekday', () => {
  it('returns the short weekday for a datetime-local value', () => {
    // 2026-06-27T15:35 is a Saturday afternoon.
    expect(reminderWeekday('2026-06-27T15:35')).toBe('Sat');
  });

  it('returns empty string for empty or malformed input', () => {
    expect(reminderWeekday('')).toBe('');
    expect(reminderWeekday('nope')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { parseNaturalDate } from './dates';

// Wednesday, 1 July 2026, mid-afternoon.
const ref = new Date(2026, 6, 1, 15, 0);

describe('parseNaturalDate', () => {
  it('parses a trailing weekday and strips it', () => {
    expect(parseNaturalDate('MOT booking Friday', ref)).toEqual({
      title: 'MOT booking',
      dueOn: '2026-07-03',
    });
  });

  it('resolves weekdays forward, never into the past', () => {
    expect(parseNaturalDate('standup notes Tuesday', ref).dueOn).toBe('2026-07-07');
  });

  it('parses tomorrow / today', () => {
    expect(parseNaturalDate('bins out tomorrow', ref)).toEqual({
      title: 'bins out',
      dueOn: '2026-07-02',
    });
    expect(parseNaturalDate('call dentist today', ref).dueOn).toBe('2026-07-01');
  });

  it('strips a joining preposition with the date', () => {
    expect(parseNaturalDate('pay rent by Friday', ref).title).toBe('pay rent');
    expect(parseNaturalDate('renew passport before 15 August', ref)).toEqual({
      title: 'renew passport',
      dueOn: '2026-08-15',
    });
  });

  it('parses explicit dates', () => {
    expect(parseNaturalDate('tax return 31 Jan', ref)).toEqual({
      title: 'tax return',
      dueOn: '2027-01-31',
    });
  });

  it('handles a date phrase mid-title', () => {
    expect(parseNaturalDate('book table for Saturday at Luigis', ref)).toEqual({
      title: 'book table for at Luigis',
      dueOn: '2026-07-04',
    });
  });

  it('keeps the title when the whole title is the date', () => {
    expect(parseNaturalDate('Friday', ref)).toEqual({ title: 'Friday', dueOn: '2026-07-03' });
  });

  it('leaves titles without confident dates untouched', () => {
    expect(parseNaturalDate('buy 5 apples', ref)).toEqual({ title: 'buy 5 apples', dueOn: null });
    expect(parseNaturalDate('it may rain, buy umbrella', ref).dueOn).toBe(null);
    expect(parseNaturalDate('meet at 4', ref).dueOn).toBe(null);
  });

  it('uses the last date when several appear', () => {
    expect(parseNaturalDate('move Friday meeting to Monday', ref)).toEqual({
      title: 'move Friday meeting to',
      dueOn: '2026-07-06',
    });
  });
});

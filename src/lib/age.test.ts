import { describe, expect, it } from 'vitest';
import { ageInfo, isWithinLiveTickWindow } from './age';
import type { Task } from '../types';

const NOW = new Date(2026, 6, 1, 12, 0, 0).getTime();

function taskCreatedAt(iso: string): Task {
  return { created_at: iso } as Task;
}

function createdMsAgo(ms: number): Task {
  return taskCreatedAt(new Date(NOW - ms).toISOString());
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 86_400_000;

describe('ageInfo', () => {
  it('shows live seconds under a minute', () => {
    expect(ageInfo(createdMsAgo(0), NOW).label).toBe('0s');
    expect(ageInfo(createdMsAgo(42 * SECOND), NOW).label).toBe('42s');
    expect(ageInfo(createdMsAgo(59 * SECOND), NOW).label).toBe('59s');
  });

  it('switches to minutes at the 60s boundary', () => {
    expect(ageInfo(createdMsAgo(60 * SECOND), NOW).label).toBe('1 min');
    expect(ageInfo(createdMsAgo(45 * MINUTE), NOW).label).toBe('45 min');
    expect(ageInfo(createdMsAgo(59 * MINUTE), NOW).label).toBe('59 min');
  });

  it('switches to hours at the 60min boundary, singular/plural', () => {
    expect(ageInfo(createdMsAgo(60 * MINUTE), NOW).label).toBe('1 hour');
    expect(ageInfo(createdMsAgo(2 * HOUR), NOW).label).toBe('2 hours');
    expect(ageInfo(createdMsAgo(23 * HOUR), NOW).label).toBe('23 hours');
  });

  it('switches to days at the 24h boundary, singular/plural', () => {
    expect(ageInfo(createdMsAgo(24 * HOUR), NOW).label).toBe('1 day');
    expect(ageInfo(createdMsAgo(5 * DAY), NOW).label).toBe('5 days');
    expect(ageInfo(createdMsAgo(29 * DAY), NOW).label).toBe('29 days');
  });

  it('switches to months at the 30-day boundary, singular/plural', () => {
    expect(ageInfo(createdMsAgo(30 * DAY), NOW).label).toBe('1 month');
    expect(ageInfo(createdMsAgo(90 * DAY), NOW).label).toBe('3 months');
  });

  it('switches to years at the 365-day boundary, singular/plural', () => {
    expect(ageInfo(createdMsAgo(365 * DAY), NOW).label).toBe('1 year');
    expect(ageInfo(createdMsAgo(2 * 365 * DAY), NOW).label).toBe('2 years');
  });

  it('clamps a future created_at (clock skew) to 0s instead of going negative', () => {
    expect(ageInfo(createdMsAgo(-5000), NOW).label).toBe('0s');
  });
});

describe('isWithinLiveTickWindow', () => {
  it('is true for the first 60 seconds', () => {
    expect(isWithinLiveTickWindow(createdMsAgo(0), NOW)).toBe(true);
    expect(isWithinLiveTickWindow(createdMsAgo(59 * SECOND), NOW)).toBe(true);
  });

  it('is false at and beyond 60 seconds', () => {
    expect(isWithinLiveTickWindow(createdMsAgo(60 * SECOND), NOW)).toBe(false);
    expect(isWithinLiveTickWindow(createdMsAgo(HOUR), NOW)).toBe(false);
  });

  it('is false for a clock-skewed future created_at', () => {
    expect(isWithinLiveTickWindow(createdMsAgo(-5000), NOW)).toBe(false);
  });
});

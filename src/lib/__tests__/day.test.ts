/**
 * Calendar days.
 *
 * This module exists because of a bug found only by running the app: a session
 * logged at 6pm local was filed under tomorrow, because the date came from
 * toISOString(), which is UTC. It put the workout on the wrong column of the
 * week strip and would have split a session from the check-in belonging with it.
 *
 * Wrong-by-one-day is the worst kind of date bug — plausible everywhere, wrong
 * only for people in certain timezones at certain hours.
 */

import { dayKey, dayOffset, recentDays, today } from '../day';

describe('dayKey', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('zero-pads month and day', () => {
    expect(dayKey(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('uses the LOCAL date, not the UTC one', () => {
    // 6pm on the 26th in any timezone behind UTC is already the 27th in UTC.
    // toISOString().slice(0,10) returned the 27th here; the answer is the 26th.
    const evening = new Date(2026, 7, 26, 18, 0, 0);
    expect(dayKey(evening)).toBe('2026-08-26');
    expect(dayKey(evening)).toBe(
      `${evening.getFullYear()}-${String(evening.getMonth() + 1).padStart(2, '0')}-${String(evening.getDate()).padStart(2, '0')}`
    );
  });

  it('handles the last instant of a local day', () => {
    expect(dayKey(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
  });

  it('handles the first instant of a local day', () => {
    expect(dayKey(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
  });
});

describe('today', () => {
  it('agrees with the local clock', () => {
    const now = new Date();
    expect(today()).toBe(dayKey(now));
  });
});

describe('dayOffset', () => {
  it('returns today at zero', () => {
    expect(dayOffset(0)).toBe(today());
  });

  it('moves backwards and forwards', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(dayOffset(-1)).toBe(dayKey(yesterday));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(dayOffset(1)).toBe(dayKey(tomorrow));
  });

  it('crosses month and year boundaries', () => {
    // Shifting the calendar date rather than adding milliseconds is what makes
    // this correct across DST, where a day is 23 or 25 hours.
    const d = new Date(2026, 0, 1);
    d.setDate(d.getDate() - 1);
    expect(dayKey(d)).toBe('2025-12-31');
  });
});

describe('recentDays', () => {
  it('returns the requested count', () => {
    expect(recentDays(7)).toHaveLength(7);
  });

  it('ends on today and is ordered oldest first', () => {
    const days = recentDays(7);
    expect(days[days.length - 1]).toBe(today());
    expect(days[0]).toBe(dayOffset(-6));
    expect([...days].sort()).toEqual(days);
  });

  it('has no duplicates', () => {
    const days = recentDays(30);
    expect(new Set(days).size).toBe(30);
  });
});

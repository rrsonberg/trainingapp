/**
 * Calendar days, in the user's own timezone.
 *
 * Every date-only column in this app — sessions.scheduled_for,
 * biometrics.recorded_on, daily_checkins.checkin_date — answers a human
 * question: which DAY did this happen on. That is a local question.
 *
 * `new Date().toISOString().slice(0, 10)` answers a different one: which day is
 * it in UTC. West of Greenwich those diverge every evening. A set logged at
 * 6pm in California was being filed under tomorrow, which puts the workout on
 * the wrong day of the week strip, splits a session from the check-in that
 * belongs with it, and quietly shifts training load into the wrong week.
 *
 * Anything that produces a YYYY-MM-DD string belongs in this file.
 */

/** The local calendar day for a Date, as YYYY-MM-DD. */
export function dayKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today, locally. */
export function today(): string {
  return dayKey();
}

/**
 * A local day offset from today. Built by shifting the calendar date rather
 * than adding milliseconds, so it stays correct across daylight-saving
 * boundaries, where a "day" is 23 or 25 hours long.
 */
export function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

/** The last `count` local days, oldest first, ending today. */
export function recentDays(count: number): string[] {
  return Array.from({ length: count }, (_, i) => dayOffset(i - (count - 1)));
}

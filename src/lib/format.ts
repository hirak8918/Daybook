/**
 * Formatting helpers. One implementation per idea, used by every screen, so no
 * figure is ever written two different ways. Durations live in lib/date
 * (`formatMinutes`); this file covers counting and dates-in-prose.
 */

import { DateKey, fromKey } from './date';

/** "1 day" / "2 days" — never "1 days". */
export function count(n: number, singular: string, pluralForm?: string): string {
  const value = Math.round(n);
  return `${value} ${value === 1 ? singular : pluralForm ?? `${singular}s`}`;
}

/** Just the noun: "1 day" → "day", "2 days" → "days". */
export function noun(n: number, singular: string, pluralForm?: string): string {
  return Math.round(n) === 1 ? singular : pluralForm ?? `${singular}s`;
}

/** "Wed, 7 Oct" — short, unambiguous, no year unless it is not this year. */
export function shortDay(key: DateKey): string {
  const d = fromKey(key);
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

/** "Wednesday, 7 October" — the Home heading. */
export function longDay(key: DateKey): string {
  return fromKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "7 Oct" — chart ticks and table cells. */
export function dayMonth(key: DateKey): string {
  return fromKey(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

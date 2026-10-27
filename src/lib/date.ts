/** Date helpers. Everything is local-time and keyed by YYYY-MM-DD. */

export type DateKey = string;

const DAY_MS = 86_400_000;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local YYYY-MM-DD for a Date. */
export function toKey(d: Date = new Date()): DateKey {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse YYYY-MM-DD as a *local* midnight (never UTC-shifted). */
export function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

export function addDays(key: DateKey, delta: number): DateKey {
  const d = fromKey(key);
  d.setDate(d.getDate() + delta);
  return toKey(d);
}

export function addMonths(key: DateKey, delta: number): DateKey {
  const d = fromKey(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toKey(d);
}

export function diffDays(a: DateKey, b: DateKey): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(key: DateKey): number {
  return fromKey(key).getDay();
}

/** Start of the week containing `key`, honouring weekStart (0 Sun / 1 Mon). */
export function startOfWeek(key: DateKey, weekStart: 0 | 1): DateKey {
  const dow = dayOfWeek(key);
  const back = (dow - weekStart + 7) % 7;
  return addDays(key, -back);
}

export function weekDays(startKey: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startKey, i));
}

export function monthShort(key: DateKey): string {
  return fromKey(key).toLocaleDateString(undefined, { month: 'short' });
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

/**
 * The one duration format used everywhere: 45 → "45m", 145 → "2h 25m",
 * 120 → "2h 00m". Never "2.0h", "2,00" or "120 / 240".
 */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h <= 0) return `${rem}m`;
  return `${h}h ${pad2(rem)}m`;
}

/** Compact axis label: 145 → "2h", 45 → "45m". Charts only. */
export function formatMinutesShort(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = m / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1).replace('.0', '')}h`;
}



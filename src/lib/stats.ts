/**
 * Statistics — the whole of Daybook's arithmetic, in one pure module.
 *
 * Everything here is computed from the stored days. There is no cache to go
 * stale and no mock number anywhere: if a figure is on screen, it was counted.
 * Two rules matter and are applied consistently:
 *
 *   · a day's "done" tasks are the tasks *completed* that day (by `doneAt`),
 *     so finishing an older task today counts today — and the historical
 *     figures never change retroactively
 *   · nothing after today is ever drawn, averaged, or picked as a "best" day
 */

import { DateKey, addDays, diffDays, fromKey, monthShort, startOfWeek, toKey, weekDays } from './date';
import type { DaybookData, Goals, Settings } from './schema';

export interface DayTotals {
  focusMin: number;
  movementMin: number;
  tasksDone: number;
  sessions: number;
  /** 0–100: the average of the three goal ratios, each capped at 100%. */
  score: number;
}

export const EMPTY_TOTALS: DayTotals = {
  focusMin: 0,
  movementMin: 0,
  tasksDone: 0,
  sessions: 0,
  score: 0,
};

function scoreOf(focusMin: number, movementMin: number, tasksDone: number, goals: Goals): number {
  const dGoal = Math.max(1, goals.deepWorkMin);
  const mGoal = Math.max(1, goals.movementMin);
  const tGoal = Math.max(1, goals.tasks);
  return Math.round(
    100 *
      Math.min(
        1,
        (Math.min(1, focusMin / dGoal) + Math.min(1, movementMin / mGoal) + Math.min(1, tasksDone / tGoal)) / 3,
      ),
  );
}

/**
 * Totals for every recorded day in one pass over the history. The heatmap and
 * the charts both need hundreds of days at once, so they use this rather than
 * calling `totalsFor` in a loop.
 */
export function totalsIndex(data: DaybookData): Map<DateKey, DayTotals> {
  const index = new Map<DateKey, DayTotals>();
  for (const [key, day] of Object.entries(data.days)) {
    index.set(key, {
      focusMin: day.sessions.reduce((a, s) => a + (Number(s.minutes) || 0), 0),
      movementMin: day.movements.reduce((a, m) => a + (Number(m.minutes) || 0), 0),
      tasksDone: 0,
      sessions: day.sessions.length,
      score: 0,
    });
  }
  // Attribute completed tasks to the day they were finished.
  for (const [dayKey, day] of Object.entries(data.days)) {
    for (const task of day.tasks) {
      if (!task.done) continue;
      const stamp = task.doneAt ? toKey(new Date(task.doneAt)) : dayKey;
      const existing = index.get(stamp);
      if (existing) existing.tasksDone += 1;
      else index.set(stamp, { ...EMPTY_TOTALS, tasksDone: 1 });
    }
  }
  for (const totals of index.values()) {
    totals.score = scoreOf(totals.focusMin, totals.movementMin, totals.tasksDone, data.settings.goals);
  }
  return index;
}

const indexCache = new WeakMap<DaybookData, Map<DateKey, DayTotals>>();

/** Memoised per data document (the store replaces the object on every change). */
export function cachedTotals(data: DaybookData): Map<DateKey, DayTotals> {
  const hit = indexCache.get(data);
  if (hit) return hit;
  const built = totalsIndex(data);
  indexCache.set(data, built);
  return built;
}

export function totalsFor(data: DaybookData, key: DateKey): DayTotals {
  return cachedTotals(data).get(key) ?? EMPTY_TOTALS;
}

/* ------------------------------------------------------------------ *
 * Goals and filters
 * ------------------------------------------------------------------ */

/** What the heatmap is measuring. One control drives heatmap + streak. */
export type HeatFilter = 'combined' | 'focus' | 'movement' | 'tasks';

export const HEAT_FILTERS: Array<{ id: HeatFilter; label: string }> = [
  { id: 'combined', label: 'Combined' },
  { id: 'focus', label: 'Focus' },
  { id: 'movement', label: 'Movement' },
  { id: 'tasks', label: 'Tasks' },
];

/** 0 → 1 (or more) progress toward the goal a filter measures. */
export function ratioFor(totals: DayTotals, goals: Goals, filter: HeatFilter): number {
  if (filter === 'focus') return totals.focusMin / Math.max(1, goals.deepWorkMin);
  if (filter === 'movement') return totals.movementMin / Math.max(1, goals.movementMin);
  if (filter === 'tasks') return totals.tasksDone / Math.max(1, goals.tasks);
  // Combined: the average of the three ratios, exactly as the daily score.
  return totals.score / 100;
}

export function goalReached(totals: DayTotals, goals: Goals, filter: HeatFilter): boolean {
  return ratioFor(totals, goals, filter) >= 1;
}

/** 0 = nothing logged · 1 ≤25% · 2 ≤50% · 3 <100% · 4 = goal met. */
export function levelFor(ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (!(ratio > 0)) return 0;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio < 1) return 3;
  return 4;
}

export function filterLabel(filter: HeatFilter): string {
  return HEAT_FILTERS.find((f) => f.id === filter)?.label ?? 'Combined';
}

/* ------------------------------------------------------------------ *
 * Streaks
 * ------------------------------------------------------------------ */

export interface StreakResult {
  current: number;
  longest: number;
  /** Date the current run began. */
  since: DateKey | null;
}

/**
 * A day counts toward a run when the goal being measured was met. One missed
 * day per week keeps the run alive without adding to it (the grace day is
 * always on in v2). Today never breaks a run — the day is still in progress —
 * so an unmet today simply does not add to the count yet.
 */
export function streakFor(data: DaybookData, filter: HeatFilter, today: DateKey = toKey()): StreakResult {
  const goals = data.settings.goals;
  const metOn = (key: DateKey) => goalReached(totalsFor(data, key), goals, filter);

  const walkBack = (from: DateKey) => {
    let count = 0;
    const graceWeeks = new Set<string>();
    let since: DateKey | null = null;
    let cursor = from;
    let guard = 0;
    while (guard++ < 900) {
      const week = startOfWeek(cursor, 1);
      if (metOn(cursor)) {
        count += 1;
        since = cursor;
      } else if (!graceWeeks.has(week)) {
        graceWeeks.add(week);
      } else {
        break;
      }
      cursor = addDays(cursor, -1);
    }
    return { count, since };
  };

  const current = metOn(today) ? walkBack(today) : walkBack(addDays(today, -1));

  // Longest run: walk the whole recorded history forwards.
  const keys = Object.keys(data.days).sort();
  let longest = 0;
  if (keys.length) {
    let run = 0;
    const graceWeeks = new Set<string>();
    let cursor = keys[0];
    const last = keys[keys.length - 1];
    let guard = 0;
    while (guard++ < 6000 && diffDays(cursor, last) <= 0) {
      const week = startOfWeek(cursor, 1);
      if (metOn(cursor)) {
        run += 1;
        longest = Math.max(longest, run);
      } else if (!graceWeeks.has(week)) {
        graceWeeks.add(week);
      } else {
        run = 0;
      }
      cursor = addDays(cursor, 1);
      if (diffDays(last, cursor) < 0) break;
    }
  }
  longest = Math.max(longest, current.count);

  return { current: current.count, longest, since: current.count > 0 ? current.since : null };
}

/** The one-line rule text, shown in the ⓘ tooltip next to the streak figure. */
export function streakRule(filter: HeatFilter): string {
  const what = filter === 'combined' ? 'all three goals' : `the ${filterLabel(filter).toLowerCase()} goal`;
  return `A day counts when you meet ${what}. One missed day a week keeps the run alive.`;
}

/* ------------------------------------------------------------------ *
 * Heatmap
 * ------------------------------------------------------------------ */

export interface HeatCell {
  key: DateKey;
  totals: DayTotals;
  ratio: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** After today: drawn as empty space, never as a zero day. */
  future: boolean;
}

export interface HeatGrid {
  /** 53 columns × 7 rows, Monday first. */
  rows: HeatCell[][];
  /** Column index → month name, for the top axis. */
  months: Array<{ column: number; label: string }>;
  /** Days with anything logged at all, inside the window. */
  activeDays: number;
  from: DateKey;
  to: DateKey;
}

const WEEKS_SHOWN = 53;

export function heatGrid(data: DaybookData, filter: HeatFilter, today: DateKey = toKey()): HeatGrid {
  const totals = cachedTotals(data);
  const goals = data.settings.goals;
  const start = addDays(startOfWeek(today, 1), -(WEEKS_SHOWN - 1) * 7);

  const rows: HeatCell[][] = Array.from({ length: 7 }, () => []);
  const months: Array<{ column: number; label: string }> = [];
  let activeDays = 0;
  let lastMonth = -1;

  for (let column = 0; column < WEEKS_SHOWN; column++) {
    for (let row = 0; row < 7; row++) {
      const key = addDays(start, column * 7 + row);
      const future = diffDays(key, today) > 0;
      const dayTotals = totals.get(key) ?? EMPTY_TOTALS;
      const ratio = ratioFor(dayTotals, goals, filter);
      if (!future && ratioFor(dayTotals, goals, 'combined') > 0) activeDays += 1;
      rows[row].push({ key, totals: dayTotals, ratio, level: future ? 0 : levelFor(ratio), future });
      if (row === 0) {
        const month = fromKey(key).getMonth();
        if (month !== lastMonth) {
          months.push({ column, label: monthShort(key) });
          lastMonth = month;
        }
      }
    }
  }

  return { rows, months, activeDays, from: start, to: today };
}

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

export type RangeId = '30D' | '12W' | '1Y';

export const RANGES: Array<{ id: RangeId; label: string }> = [
  { id: '30D', label: '30D' },
  { id: '12W', label: '12W' },
  { id: '1Y', label: '1Y' },
];

export interface Bar {
  key: DateKey;
  label: string;
  /** Minutes of focus. */
  value: number;
  isToday: boolean;
}

/** Focus minutes per bar for the chosen range. Future days are never drawn. */
export function focusBars(data: DaybookData, range: RangeId, today: DateKey = toKey()): Bar[] {
  const totals = cachedTotals(data);

  if (range === '30D') {
    return Array.from({ length: 30 }, (_, i) => {
      const key = addDays(today, -(29 - i));
      return { key, label: String(fromKey(key).getDate()), value: totals.get(key)?.focusMin ?? 0, isToday: key === today };
    });
  }

  if (range === '12W') {
    return Array.from({ length: 12 }, (_, i) => {
      const start = addDays(startOfWeek(today, 1), -(11 - i) * 7);
      const days = weekDays(start).filter((key) => diffDays(key, today) <= 0);
      const value = days.reduce((a, key) => a + (totals.get(key)?.focusMin ?? 0), 0);
      const last = days[days.length - 1] ?? start;
      return { key: start, label: shortTick(last), value, isToday: diffDays(today, start) < 7 };
    });
  }

  return Array.from({ length: 12 }, (_, i) => {
    const cursor = new Date(fromKey(today));
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() - (11 - i));
    const key = toKey(cursor);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    let value = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const k = `${key.slice(0, 8)}${String(day).padStart(2, '0')}`;
      if (diffDays(k, today) > 0) break;
      value += totals.get(k)?.focusMin ?? 0;
    }
    return { key, label: monthShort(key), value, isToday: key.slice(0, 7) === today.slice(0, 7) };
  });
}

function shortTick(key: DateKey): string {
  return `${fromKey(key).getDate()} ${monthShort(key)}`;
}

export interface TagBar {
  tag: string;
  minutes: number;
}

/**
 * Focus minutes per tag for the same window as the range toggle. The top five
 * tags are drawn individually; everything else is folded into "Other".
 */
export function tagBars(data: DaybookData, range: RangeId, today: DateKey = toKey()): TagBar[] {
  const windowDays = range === '30D' ? 30 : range === '12W' ? 84 : 365;
  const from = addDays(today, -(windowDays - 1));
  const byTag = new Map<string, number>();

  for (const [key, day] of Object.entries(data.days)) {
    if (diffDays(key, from) < 0 || diffDays(key, today) > 0) continue;
    for (const session of day.sessions) {
      const tag = session.tag?.trim() ? session.tag.trim() : 'No tag';
      byTag.set(tag, (byTag.get(tag) ?? 0) + (Number(session.minutes) || 0));
    }
  }

  const sorted = [...byTag.entries()]
    .map(([tag, minutes]) => ({ tag, minutes }))
    .filter((t) => t.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  if (sorted.length <= 6) return sorted;
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((a, t) => a + t.minutes, 0);
  return [...top, { tag: 'Other', minutes: rest }];
}

/* ------------------------------------------------------------------ *
 * Stat row
 * ------------------------------------------------------------------ */

export interface StatFigures {
  /** Focus minutes logged since Monday. */
  weekMin: number;
  weekFrom: DateKey;
  /** Average focus minutes per day over the last 30 days. */
  averagePerDay: number;
  /** The best day in the whole record (never in the future). */
  best: { key: DateKey; focusMin: number } | null;
  streak: StreakResult;
  /** Active days inside the heatmap window. */
  activeDays: number;
}

export function statFigures(data: DaybookData, filter: HeatFilter, today: DateKey = toKey()): StatFigures {
  const totals = cachedTotals(data);

  const weekFrom = startOfWeek(today, 1);
  let weekMin = 0;
  for (let key = weekFrom; diffDays(key, today) <= 0; key = addDays(key, 1)) {
    weekMin += totals.get(key)?.focusMin ?? 0;
  }

  let sum30 = 0;
  for (let i = 0; i < 30; i++) sum30 += totals.get(addDays(today, -i))?.focusMin ?? 0;

  let best: { key: DateKey; focusMin: number } | null = null;
  for (const [key, dayTotals] of totals) {
    if (diffDays(key, today) > 0) continue; // never a future day
    if (dayTotals.focusMin <= 0) continue;
    if (!best || dayTotals.focusMin > best.focusMin) best = { key, focusMin: dayTotals.focusMin };
  }

  return {
    weekMin,
    weekFrom,
    averagePerDay: Math.round(sum30 / 30),
    best,
    streak: streakFor(data, filter, today),
    activeDays: heatGrid(data, filter, today).activeDays,
  };
}

/**
 * The single insight line. Only written once there are four weeks of history
 * behind it — an "insight" drawn from three days is a guess, not a finding.
 */
export function bestWeekdayLine(data: DaybookData, today: DateKey = toKey()): string | null {
  const firstDay = Object.keys(data.days).sort()[0];
  if (!firstDay || diffDays(today, firstDay) < 28) return null;

  const totals = cachedTotals(data);
  const sums = new Map<number, { total: number; days: number }>();
  const weeksWithData = new Set<string>();
  for (let i = 0; i < 56; i++) {
    const key = addDays(today, -i);
    const dayTotals = totals.get(key);
    if (!dayTotals || dayTotals.focusMin <= 0) continue;
    weeksWithData.add(startOfWeek(key, 1));
    const weekday = fromKey(key).getDay();
    const bucket = sums.get(weekday) ?? { total: 0, days: 0 };
    bucket.total += dayTotals.focusMin;
    bucket.days += 1;
    sums.set(weekday, bucket);
  }
  if (weeksWithData.size < 4) return null;

  let best = -1;
  let bestAvg = 0;
  for (const [weekday, bucket] of sums) {
    if (bucket.days < 3) continue;
    const avg = bucket.total / bucket.days;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = weekday;
    }
  }
  if (best < 0) return null;
  const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][best];
  return `You focus best on ${name}s.`;
}

export type { Settings };

/**
 * Seed generator — eight weeks of plausible, deterministic demo copy so the
 * charts, streaks and heatmap have something real to compute on first launch.
 * Deterministic because the same seed always produces the same edition; users
 * can wipe it with "Start fresh" in Settings.
 */

import { DateKey, addDays, fromKey, toKey } from './date';
import { DayRecord, FocusSession, MovementEntry, MovementType, Priority, Settings, Task } from './schema';

/** Tiny deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TASK_POOL: Array<{ title: string; priority: Priority }> = [
  { title: 'Draft the second section', priority: 'A' },
  { title: 'Proof yesterday’s notes', priority: 'B' },
  { title: 'Reply to the studio thread', priority: 'B' },
  { title: 'Reconcile the invoices', priority: 'A' },
  { title: 'Outline Thursday’s interview', priority: 'A' },
  { title: 'Clear the reading pile', priority: 'C' },
  { title: 'Order fresh ink', priority: 'C' },
  { title: 'Tidy the desk, properly', priority: 'C' },
  { title: 'Send the manuscript to print', priority: 'A' },
  { title: 'Book the physio', priority: 'B' },
  { title: 'Review the analytics column', priority: 'B' },
  { title: 'Water the plants', priority: 'C' },
  { title: 'File the tax receipts', priority: 'B' },
  { title: 'Edit chapter four', priority: 'A' },
];

const MOVEMENT_TYPES: MovementType[] = ['run', 'gym', 'yoga', 'walk', 'sport'];

const NOTES = [
  'Slow start, strong finish. The trick was writing the ugly first paragraph and refusing to reread it.',
  'Too many small interruptions before noon. Next week the phone lives in the drawer.',
  'Best run in a month. Ideas arrive in the order they like, not the order you need.',
  'Long day of correspondence. Necessary, but it is not the work.',
  'Cleared the backlog and the desk. Tomorrow the interesting part begins.',
  'Interviews all afternoon. Everyone said something better than my questions deserved.',
  'Wrote until the words went grey, then stopped. Stopping early is still stopping.',
];

/**
 * Build 56 days ending yesterday, plus a lightly-started today.
 */
export function generateSeedDays(today: DateKey = toKey(), settings?: Settings): Record<string, DayRecord> {
  const days: Record<string, DayRecord> = {};
  const r = rng(hashString(`daybook:${today}`));
  const tags = settings?.tags?.length ? settings.tags : ['Manuscript', 'Studio', 'Invoices', 'Study'];

  for (let back = 56; back >= 1; back--) {
    const key = addDays(today, -back);
    const dow = fromKey(key).getDay(); // 0 Sun
    const weekend = dow === 0 || dow === 6;
    const day: DayRecord = { date: key, sessions: [], movements: [], tasks: [], note: '' };

    // Roughly one blank day a fortnight keeps streaks honest.
    const blank = r() < (weekend ? 0.16 : 0.05);
    if (blank) {
      days[key] = day;
      continue;
    }

    // --- Deep work: 1–5 sessions, heavier midweek ------------------------
    const base = weekend ? 1.1 : 2.6 + (dow === 3 ? 1.4 : dow === 2 ? 0.8 : 0);
    let hours = Math.max(0.5, base + (r() - 0.4) * 2.2);
    let cursorMinutes = 9 * 60 + Math.floor(r() * 90);
    while (hours > 0.55) {
      const minutes = Math.round((45 + r() * 80) / 5) * 5;
      const use = Math.min(minutes, Math.round(hours * 60));
      const started = new Date(fromKey(key));
      started.setMinutes(cursorMinutes);
      const session: FocusSession = {
        id: `seed_${key}_s${day.sessions.length}`,
        tag: pick(r, tags),
        startedAt: started.toISOString(),
        minutes: Math.max(20, use),
        auto: r() < 0.55,
      };
      day.sessions.push(session);
      hours -= use / 60;
      cursorMinutes += use + Math.round(20 + r() * 70);
      if (cursorMinutes > 19 * 60) break;
    }

    // --- Movement --------------------------------------------------------
    if (r() < (weekend ? 0.9 : 0.66)) {
      const type = weekend ? pick(r, ['run', 'walk', 'sport', 'yoga'] as MovementType[]) : pick(r, MOVEMENT_TYPES);
      const minutes = Math.round((25 + r() * 50) / 5) * 5;
      const at = new Date(fromKey(key));
      at.setHours(weekend ? 10 + Math.floor(r() * 8) : 17 + Math.floor(r() * 4), Math.floor(r() * 60));
      const entry: MovementEntry = {
        id: `seed_${key}_m0`,
        type,
        minutes,
        intensity: 1 + Math.floor(r() * 5),
        at: at.toISOString(),
      };
      day.movements.push(entry);
    }

    // --- Tasks -----------------------------------------------------------
    const taskCount = weekend ? 2 + Math.floor(r() * 2) : 4 + Math.floor(r() * 4);
    const start = Math.floor(r() * (TASK_POOL.length - taskCount));
    for (let i = 0; i < taskCount; i++) {
      const template = TASK_POOL[(start + i) % TASK_POOL.length];
      const done = r() < (weekend ? 0.62 : 0.74);
      const created = new Date(fromKey(key));
      created.setHours(8 + Math.floor(r() * 3), Math.floor(r() * 60));
      const task: Task = {
        id: `seed_${key}_t${i}`,
        title: template.title,
        priority: template.priority,
        done,
        doneAt: done ? new Date(created.getTime() + (2 + r() * 9) * 3_600_000).toISOString() : undefined,
        createdAt: created.toISOString(),
        order: i,
      };
      day.tasks.push(task);
    }

    // A few notes only — marginalia should feel like a decision, not a habit.
    if (r() < 0.42) day.note = pick(r, NOTES);

    days[key] = day;
  }

  /**
   * Today gets a light, unfinished edition — and only work that could
   * plausibly have happened by now. Launch Daybook at 3am and the page is
   * honestly blank; open it after lunch and there are two sessions filed and
   * the goal still open. Demo data that lies about this morning would be worse
   * than no demo data at all.
   */
  const todayKey = today;
  const t: DayRecord = { date: todayKey, sessions: [], movements: [], tasks: [], note: '' };
  const nowH = new Date().getHours();
  const isToday = today === toKey();
  const plausibleHours = isToday ? [7, 9, 11, 14, 16, 18].filter((h) => h <= nowH - 1).slice(-2) : [9, 11];

  plausibleHours.forEach((hour, i) => {
    const started = new Date(fromKey(todayKey));
    started.setHours(hour, 15 + Math.floor(r() * 30));
    t.sessions.push({
      id: `seed_${todayKey}_s${i}`,
      tag: pick(r, tags),
      startedAt: started.toISOString(),
      minutes: 45 + Math.floor(r() * 4) * 10,
      auto: true,
    });
  });

  const movedAt = new Date(fromKey(todayKey));
  const hasMovedYet = !isToday || nowH >= 8;
  if (hasMovedYet) {
    movedAt.setHours(isToday ? Math.max(6, Math.min(nowH - 2, 8)) : 7, 30);
    t.movements.push({
      id: `seed_${todayKey}_m0`,
      type: pick(r, ['walk', 'run', 'gym'] as MovementType[]),
      minutes: 35,
      intensity: 3,
      at: movedAt.toISOString(),
    });
  }

  // The demo day always opens with one finished item, so the "1 of 5 done"
  // line is never zero and the completion path is visible from the start.
  const stamp = new Date(fromKey(todayKey));
  if (isToday) stamp.setTime(Math.max(stamp.getTime(), Date.now() - 30 * 60_000));
  else stamp.setHours(15, 5);
  t.tasks.push(
    {
      id: `seed_${todayKey}_t0`,
      title: 'Draft the second section',
      priority: 'A',
      done: true,
      doneAt: stamp.toISOString(),
      createdAt: new Date().toISOString(),
      order: 0,
    },
    { id: `seed_${todayKey}_t1`, title: 'Proof yesterday’s notes', priority: 'B', done: false, createdAt: new Date().toISOString(), order: 1 },
    { id: `seed_${todayKey}_t2`, title: 'Reply to the studio thread', priority: 'B', done: false, createdAt: new Date().toISOString(), order: 2 },
    { id: `seed_${todayKey}_t3`, title: 'Clear the reading pile', priority: 'C', done: false, createdAt: new Date().toISOString(), order: 3 },
  );

  days[todayKey] = t;

  return days;
}

/**
 * Tasks — the single rolling to-do list.
 *
 * v1 kept a separate list per day (with carry-over between editions). v2 shows
 * one list. The storage did not change: tasks still live inside their day
 * record, which is what keeps the history honest and the "N done that day"
 * figures correct. What changed is the *view*:
 *
 *   · the list is every open task created from `meta.tasksStartAt` onwards
 *   · checking a task sets `done` + `doneAt`, so it drops out of the list and
 *     counts toward the day it was finished on
 *   · open tasks from the retired per-day editions stay in the file, untouched
 *     and unlisted, instead of flooding a list meant to stay calm
 *   · at most MAX_OPEN_TASKS are shown; the rest wait their turn
 */

import { DateKey, toKey } from './date';
import type { DaybookData, Task } from './schema';

/** The list never grows past this: it is what makes "no scroll" possible. */
export const MAX_OPEN_TASKS = 7;

export interface OpenTask extends Task {
  /** The day record the task is stored in (needed for updates and deletes). */
  date: DateKey;
}

function createdKey(task: Task): DateKey {
  const t = Date.parse(task.createdAt);
  return Number.isFinite(t) ? toKey(new Date(t)) : '1970-01-01';
}

/** True when the task belongs to the rolling list rather than the archive. */
function inRollingList(data: DaybookData, task: Task): boolean {
  const start = data.meta.tasksStartAt;
  if (!start) return true;
  return createdKey(task) >= start;
}

/** Every open task in the rolling list, newest first. */
export function openTasks(data: DaybookData): OpenTask[] {
  const out: OpenTask[] = [];
  for (const [date, day] of Object.entries(data.days)) {
    for (const task of day.tasks) {
      if (task.done) continue;
      if (!inRollingList(data, task)) continue;
      out.push({ ...task, date });
    }
  }
  return out.sort((a, b) => {
    const cmp = b.createdAt.localeCompare(a.createdAt);
    return cmp !== 0 ? cmp : a.title.localeCompare(b.title);
  });
}

/** The slice the list shows, plus how many are waiting below it. */
export function visibleTasks(data: DaybookData): { shown: OpenTask[]; waiting: number; total: number } {
  const all = openTasks(data);
  return { shown: all.slice(0, MAX_OPEN_TASKS), waiting: Math.max(0, all.length - MAX_OPEN_TASKS), total: all.length };
}

/** True while the list is at capacity: the input is disabled, not hidden. */
export function listIsFull(data: DaybookData): boolean {
  return openTasks(data).length >= MAX_OPEN_TASKS;
}

/**
 * Completed tasks attributed to a single day (by `doneAt`). Tasks completed in
 * v1 without a timestamp fall back to the day record they sit in, so the
 * heatmap and streaks read exactly the same after the upgrade.
 */
export function tasksCompletedOn(data: DaybookData, key: DateKey): number {
  let n = 0;
  for (const [dayKey, day] of Object.entries(data.days)) {
    for (const task of day.tasks) {
      if (!task.done) continue;
      const stamp = task.doneAt ? toKey(new Date(task.doneAt)) : dayKey;
      if (stamp === key) n += 1;
    }
  }
  return n;
}

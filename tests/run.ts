/**
 * Daybook self-tests — the parts that would be embarrassing to get wrong.
 *
 *   npm test
 *
 * Runs on the *real* modules: the shared reducer (which main and renderer both
 * execute), the storage layer with its atomic writes, pre-migration copies and
 * rolling backups, the statistics that every figure on screen comes from, and
 * the Pomodoro service with its end-timestamp reconciliation. No test framework
 * is involved on purpose: `scripts/test.mjs` bundles this file with esbuild and
 * runs it on Node, so it behaves the same in PowerShell and cmd.exe.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Storage } from '../electron/storage';
import { PomodoroService } from '../electron/pomodoro';
import { applyAction, sanitizeAction, type Action } from '../src/lib/reducer';
import {
  bestWeekdayLine,
  focusBars,
  heatGrid,
  levelFor,
  ratioFor,
  statFigures,
  streakFor,
  tagBars,
  totalsFor,
} from '../src/lib/stats';
import {
  DATA_VERSION,
  NOTE_HTML_MAX,
  ONBOARDING_VERSION,
  defaultData,
  migrate,
  type DaybookData,
  type DayRecord,
  type Task,
} from '../src/lib/schema';
import type { TimerSnapshot } from '../src/lib/ipc';
import { generateSeedDays } from '../src/lib/seed';
import { addDays, addMonths, formatMinutes, formatMinutesShort, startOfWeek, toKey } from '../src/lib/date';
import { count, noun } from '../src/lib/format';
import { NAME_MAX, cleanName, nameError } from '../src/lib/name';
import { MAX_OPEN_TASKS, listIsFull, openTasks, taskBuckets, tasksCompletedOn, visibleTasks } from '../src/lib/tasks';

/* ------------------------------------------------------------------ *
 * Micro test harness
 * ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];
let group = '';

const describe = (name: string) => {
  group = name;
  process.stdout.write(`\n\u001b[1m${name}\u001b[0m\n`);
};

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    process.stdout.write(`  \u001b[32m✓\u001b[0m ${label}\n`);
  } else {
    failures.push(`${group} → ${label}${detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
    process.stdout.write(`  \u001b[31m✗ ${label}\u001b[0m${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}\n`);
  }
}

const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, Object.is(actual, expected), { actual, expected });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daybook-test-'));
const today = toKey();

/** A day record with sessions, movement and `done` completed tasks. */
function dayWith(sessions: number[], movement: number[], done: number, date = today): DayRecord {
  return {
    date,
    note: '',
    sessions: sessions.map((minutes, i) => ({
      id: `s${i}`,
      tag: 'Test',
      startedAt: new Date(`${date}T09:0${i}:00`).toISOString(),
      minutes,
    })),
    movements: movement.map((minutes, i) => ({
      id: `m${i}`,
      type: 'run' as const,
      minutes,
      intensity: 3,
      at: new Date(`${date}T07:0${i}:00`).toISOString(),
    })),
    tasks: Array.from({ length: done + 1 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      priority: 'B' as const,
      done: i < done,
      doneAt: i < done ? new Date(`${date}T12:00:00`).toISOString() : undefined,
      createdAt: new Date(`${date}T08:00:00`).toISOString(),
      order: i,
    })),
  };
}

/** Wrap hand-built day records into a document the statistics can read. */
function dataWithDays(days: Record<string, DayRecord>, tasksStartAt: string | null = null): DaybookData {
  const base = defaultData();
  return { ...base, days, meta: { ...base.meta, tasksStartAt } };
}

/** A day with nothing in it at all — no sessions, no movement, no tasks. */
function blankDay(date: string): DayRecord {
  return { date, note: '', sessions: [], movements: [], tasks: [] };
}

/* ------------------------------------------------------------------ *
 * 1. Schema & migrations
 * ------------------------------------------------------------------ */

describe('Schema and migrations');
{
  const fresh = defaultData(new Date('2026-01-01T08:00:00Z'));
  eq('default document carries the current version', fresh.version, DATA_VERSION);
  eq('the schema is version 5', DATA_VERSION, 5);
  check('a fresh document has no days', Object.keys(fresh.days).length === 0);
  eq('a fresh document has an empty note library', fresh.notes.length, 0);
  eq('a fresh document has no task-list anchor', fresh.meta.tasksStartAt, null);
  eq('a fresh document has no name yet', fresh.profile, undefined);
  eq('and says the greeting is still owed', fresh.onboarding?.completed, false);
  eq('the custom timer defaults to 30 minutes', fresh.timer.customMinutes, 30);

  // A v0 document: missing keys everywhere, an extra unknown field, junk keys.
  const legacy = {
    version: 0,
    createdAt: '2025-06-01T00:00:00.000Z',
    settings: { goals: { deepWorkMin: 120 }, theme: 'dark', weekStart: 0, nonsense: true },
    days: {
      '2025-06-02': { sessions: [{ id: 'a', tag: 'Legacy', startedAt: '2025-06-02T09:00:00Z', minutes: 45 }], tasks: [] },
      'not-a-date': { sessions: [{ minutes: 5 }] },
    },
    timer: { mode: 'nonsense', running: true, endsAt: null, remainingMs: -5, round: -2 },
  };
  const migrated = migrate(legacy);
  eq('migrated to current version', migrated.version, DATA_VERSION);
  eq('kept the original createdAt', migrated.createdAt, '2025-06-01T00:00:00.000Z');
  eq('user goal survived the merge', migrated.settings.goals.deepWorkMin, 120);
  eq('missing goal filled from defaults', migrated.settings.goals.movementMin, 45);
  eq('theme preserved', migrated.settings.theme, 'dark');
  eq('junk day keys dropped', Object.keys(migrated.days).length, 1);
  eq('legacy session survived', migrated.days['2025-06-02'].sessions[0].tag, 'Legacy');
  eq('impossible timer mode coerced', migrated.timer.mode, 'focus');
  eq('running without an end time is not running', migrated.timer.running, false);
  eq('negative remaining clamped', migrated.timer.remainingMs >= 0, true);
  check('unknown settings keys not copied through', !('nonsense' in migrated.settings));

  // A realistic v1 document: per-day tasks, a note, the settings v2 removed.
  const v1: Record<string, unknown> = {
    version: 1,
    createdAt: '2026-02-02T09:00:00.000Z',
    settings: {
      goals: { deepWorkMin: 300, movementMin: 30, tasks: 6 },
      pomodoro: { focusMin: 50, shortBreakMin: 10, longBreakMin: 20, roundsBeforeLong: 3, tickSound: true, chimeSound: true, autoStartBreaks: true, autoStartFocus: false },
      tags: ['Manuscript', 'Studio'],
      weekStart: 0,
      graceDay: false,
      autoUpdate: true,
      theme: 'dark',
      lastTag: 'Studio',
    },
    days: {
      '2026-02-01': {
        date: '2026-02-01',
        note: 'A quiet Sunday',
        sessions: [{ id: 'x1', tag: 'Manuscript', startedAt: '2026-02-01T09:00:00Z', minutes: 90, auto: true }],
        movements: [{ id: 'm1', type: 'run', minutes: 40, intensity: 4, at: '2026-02-01T07:00:00Z' }],
        tasks: [
          { id: 't1', title: 'Old open task', priority: 'A', done: false, createdAt: '2026-02-01T08:00:00Z', order: 0 },
          { id: 't2', title: 'Finished task', priority: 'B', done: true, doneAt: '2026-02-01T17:00:00Z', createdAt: '2026-02-01T08:00:00Z', order: 1 },
        ],
      },
    },
    timer: { mode: 'focus', running: false, endsAt: null, remainingMs: 600_000, round: 2, tag: 'Studio', startedAt: null, completed: 7 },
    meta: { launches: 9, lastOpenedAt: '2026-02-02T09:00:00Z', seeded: false },
  };
  const upgraded = migrate(structuredClone(v1));
  eq('v1 upgrades to v5', upgraded.version, 5);
  // The Welcome screen is the one thing an upgrade does not invent: a document
  // with no name is exactly what asks the question, once.
  eq('an upgrade is not given a name', upgraded.profile, undefined);
  eq('and is marked as not yet greeted', upgraded.onboarding?.completed, false);
  eq('the rolling list starts today', upgraded.meta.tasksStartAt, today);
  eq('the grace day is always on in v2', upgraded.settings.graceDay, true);
  eq('weeks start on Monday in v2', upgraded.settings.weekStart, 1);
  eq('the last custom length is seeded', upgraded.timer.customMinutes, 30);
  check('the removed tick-sound setting is gone', !('tickSound' in upgraded.settings));
  check('the removed auto-update setting is gone', !('autoUpdate' in upgraded.settings));
  eq('goal edited in v1 kept', upgraded.settings.goals.deepWorkMin, 300);
  eq('timer lengths kept', upgraded.settings.pomodoro.focusMin, 50);
  eq('tag list kept', upgraded.settings.tags.join(','), 'Manuscript,Studio');
  eq('sessions kept', upgraded.days['2026-02-01'].sessions.length, 1);
  eq('session minutes kept', upgraded.days['2026-02-01'].sessions[0].minutes, 90);
  eq('movement kept', upgraded.days['2026-02-01'].movements[0].minutes, 40);
  eq('the daily note is kept, unused but not deleted', upgraded.days['2026-02-01'].note, 'A quiet Sunday');
  eq('a v1 document gains an empty note library', upgraded.notes.length, 0);
  eq('no task was deleted', upgraded.days['2026-02-01'].tasks.length, 2);

  // A v4 note sheet becomes the first note in the v5 library.
  const noted = migrate({
    ...structuredClone(v1),
    notes: { html: '<p><strong>Read</strong> the proofs.</p>', updatedAt: '2026-04-01T12:00:00.000Z' },
  });
  eq('a stored note becomes a titled card', noted.notes[0].title, 'First note');
  eq('a stored note body is kept', noted.notes[0].html, '<p><strong>Read</strong> the proofs.</p>');
  eq('with the moment it was edited', noted.notes[0].updatedAt, '2026-04-01T12:00:00.000Z');
  const hugeNote = migrate({ ...structuredClone(v1), notes: { html: 'x'.repeat(NOTE_HTML_MAX + 500) } });
  eq('an oversized note is clamped on read', hugeNote.notes[0].html.length, NOTE_HTML_MAX);

  // A seeded v4 document is cleaned on upgrade, but a user row beside it stays.
  const seededDoc = {
    version: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    settings: {},
    days: {
      '2026-01-02': {
        date: '2026-01-02',
        note: 'Demo note',
        sessions: [{ id: 'seed_s', tag: 'Demo', startedAt: '2026-01-02T09:00:00Z', minutes: 30 }],
        movements: [{ id: 'seed_m', type: 'walk', minutes: 20, intensity: 2, at: '2026-01-02T07:00:00Z' }],
        tasks: [
          { id: 'seed_t', title: 'Demo task', priority: 'B', done: false, createdAt: '2026-01-02T08:00:00Z', order: 0 },
          { id: 'mine_t', title: 'My task', priority: 'B', done: false, createdAt: '2026-01-02T10:00:00Z', order: 1 },
        ],
      },
    },
    timer: {},
    meta: { seeded: true },
  };
  const cleaned = migrate(seededDoc);
  eq('the demo day is gone except for the user task', Object.keys(cleaned.days).length, 1);
  eq('the demo task is removed', cleaned.days['2026-01-02'].tasks.length, 1);
  eq('the user task is kept', cleaned.days['2026-01-02'].tasks[0].title, 'My task');
  eq('the demo session is removed', cleaned.days['2026-01-02'].sessions.length, 0);
  eq('the demo note is removed', cleaned.days['2026-01-02'].note, '');
  eq('the seeded flag is cleared', cleaned.meta.seeded, false);

  // A name, once saved, survives every later read of the file.
  const named = migrate({
    ...structuredClone(v1),
    profile: { name: 'Ada Lovelace', createdAt: '2026-03-01T10:00:00.000Z' },
  });
  eq('a stored name is kept', named.profile?.name, 'Ada Lovelace');
  eq('with the moment it was given', named.profile?.createdAt, '2026-03-01T10:00:00.000Z');
  eq('and the greeting is marked done', named.onboarding?.completed, true);
  eq('at the current payload version', named.onboarding?.version, ONBOARDING_VERSION);

  // Hand-edited or corrupted names are treated as “no name” rather than shown
  // back to the owner or written to the Welcome heading.
  const junk = migrate({ ...structuredClone(v1), profile: { name: '   ' } });
  eq('a blank stored name counts as no name', junk.profile, undefined);
  const numbered = migrate({ ...structuredClone(v1), profile: { name: 'Agent 47' } });
  eq('a stored name with digits is refused', numbered.profile, undefined);
  const edited = migrate({ ...structuredClone(v1), profile: { name: 'Ada   Lovelace', extra: 'junk' } });
  eq('a stored name is normalised', edited.profile?.name, 'Ada Lovelace');
  check('nothing unknown is copied out of a stored profile', !('extra' in (edited.profile ?? {})));
  eq('a name with no timestamp borrows the document’s', edited.profile?.createdAt, '2026-02-02T09:00:00.000Z');

  // Idempotent: migrating an already-migrated document changes nothing.
  const again = migrate(structuredClone(upgraded));
  eq('migrating twice is a no-op', JSON.stringify(again), JSON.stringify(upgraded));
  const namedAgain = migrate(structuredClone(named));
  eq('and so is a named document', JSON.stringify(namedAgain), JSON.stringify(named));

  const recovered = migrate({ version: 99, days: null, settings: null });
  check('a wildly future version still yields a usable document', recovered.version === DATA_VERSION && typeof recovered.days === 'object');
}

/* ------------------------------------------------------------------ *
 * 2. The rolling task list
 * ------------------------------------------------------------------ */

describe('The rolling task list');
{
  const yesterday = addDays(today, -1);
  const old = addDays(today, -30);

  let data = defaultData();
  data = { ...data, days: { [old]: blankDay(old), [yesterday]: blankDay(yesterday), [today]: blankDay(today) } };

  // Three open tasks: one written a month ago (as v1 did — the timestamp is
  // the day it was written), two added today.
  const staleTask: Task = {
    id: 'stale',
    title: 'Stale item',
    priority: 'B',
    done: false,
    createdAt: `${old}T08:00:00.000Z`,
    order: 0,
  };
  data = { ...data, days: { ...data.days, [old]: { ...data.days[old], tasks: [staleTask] } } };
  data = applyAction(data, { type: 'task/add', date: today, title: 'Recent item' });
  data = applyAction(data, { type: 'task/add', date: today, title: 'Newest item' });

  eq('without an anchor every open task is listed', openTasks(data).length, 3);

  // From v1.1 the anchored list ignores the retired per-day leftovers.
  const anchored: DaybookData = { ...data, meta: { ...data.meta, tasksStartAt: today } };
  eq('open tasks from the retired editions are not listed', openTasks(anchored).length, 2);
  check('but they are still in the file', anchored.days[old].tasks.length === 1);
  eq('the list runs newest first', openTasks(anchored)[0].title, 'Newest item');
  eq('the day a task lives in travels with it', openTasks(anchored)[0].date, today);

  // The cap: seven shown, the rest wait their turn.
  let many: DaybookData = { ...anchored, meta: { ...anchored.meta, tasksStartAt: null } };
  for (let i = 0; i < 6; i++) many = applyAction(many, { type: 'task/add', date: today, title: `Task ${i}` });
  eq('nine open tasks in total', openTasks(many).length, 9);
  eq('all open tasks are shown', visibleTasks(many).shown.length, 9);
  eq('nothing is hidden behind a short cap', visibleTasks(many).waiting, 0);
  eq('the list is not full at nine', listIsFull(many), false);

  const buckets = taskBuckets(many, today);
  eq('today’s tasks are grouped separately', buckets.today.length, 8);
  eq('the old task is carried into the remaining group', buckets.carried.length, 1);
  eq('the carried task keeps its original day', buckets.carried[0].origin, old);

  // Completing the oldest still leaves the list over the cap; finishing enough
  // of them brings it back under.
  const oldest = openTasks(many).find((t) => t.title === 'Stale item')!;
  const afterDone = applyAction(many, { type: 'task/toggle', date: oldest.date, id: oldest.id });
  eq('the finished task leaves the list', openTasks(afterDone).length, 8);
  eq('no open task is hidden by the old cap', visibleTasks(afterDone).waiting, 0);
  eq('eight open is still an ordinary list', listIsFull(afterDone), false);
  eq('an old task finished today counts today', tasksCompletedOn(afterDone, today), 1);
  eq('and not on the day it was written', tasksCompletedOn(afterDone, old), 0);
  let shrinking = afterDone;
  for (const task of openTasks(shrinking).slice(0, 2)) {
    shrinking = applyAction(shrinking, { type: 'task/toggle', date: task.date, id: task.id });
  }
  eq('finishing tasks reduces the list', openTasks(shrinking).length, 6);
  eq('and the input stays usable', listIsFull(shrinking), false);

  // Reopening puts it back, with no completion stamp.
  const reopened = applyAction(afterDone, { type: 'task/toggle', date: oldest.date, id: oldest.id });
  eq('reopening returns it to the list', openTasks(reopened).length, 9);
  eq('reopening clears the stamp', tasksCompletedOn(reopened, today), 0);

  // v1 tasks that were completed without a stamp still count on their own day.
  const legacyDay: DayRecord = {
    ...blankDay(old),
    tasks: [{ id: 'l1', title: 'Filed in v1', priority: 'B', done: true, createdAt: `${old}T08:00:00.000Z`, order: 0 }],
  };
  const legacyData = dataWithDays({ [old]: legacyDay });
  eq('a v1 completion without a stamp counts on its own day', tasksCompletedOn(legacyData, old), 1);

  // Deleting removes it everywhere.
  const gone = applyAction(many, { type: 'task/remove', date: oldest.date, id: oldest.id });
  eq('deleting removes the task', openTasks(gone).some((t) => t.title === 'Stale item'), false);

  // A fresh reset starts the list today and seeds a plausible day one.
  const seeded = applyAction(defaultData(), { type: 'data/reset', seed: true });
  eq('a seeded document anchors the list', seeded.meta.tasksStartAt, today);
  check('the seeded list has open items to work with', openTasks(seeded).length > 0 && openTasks(seeded).length <= MAX_OPEN_TASKS, openTasks(seeded).length);
  eq('one task is already finished in the seeded edition', tasksCompletedOn(seeded, today), 1);
}

/* ------------------------------------------------------------------ *
 * 3. Reducer
 * ------------------------------------------------------------------ */

describe('Reducer');
{
  let data: DaybookData = defaultData();
  data = applyAction(data, { type: 'session/add', date: today, session: { tag: 'Studio', startedAt: new Date().toISOString(), minutes: 50 } });
  data = applyAction(data, { type: 'session/add', date: today, session: { tag: 'Studio', startedAt: new Date().toISOString(), minutes: 25 } });
  eq('two sessions logged', data.days[today].sessions.length, 2);
  eq('session ids are unique', new Set(data.days[today].sessions.map((s) => s.id)).size, 2);

  const sessionId = data.days[today].sessions[0].id;
  data = applyAction(data, { type: 'session/update', date: today, id: sessionId, patch: { minutes: 75 } });
  eq('a session can be corrected', data.days[today].sessions[0].minutes, 75);
  data = applyAction(data, { type: 'session/remove', date: today, id: sessionId });
  eq('a session can be deleted', data.days[today].sessions.length, 1);

  data = applyAction(data, { type: 'movement/add', date: today, entry: { type: 'run', minutes: 40, intensity: 4, at: new Date().toISOString() } });
  eq('movement logged', data.days[today].movements.length, 1);
  eq('intensity kept', data.days[today].movements[0].intensity, 4);
  const movementId = data.days[today].movements[0].id;
  data = applyAction(data, { type: 'movement/update', date: today, id: movementId, patch: { minutes: 55 } });
  eq('movement corrected', data.days[today].movements[0].minutes, 55);
  data = applyAction(data, { type: 'movement/remove', date: today, id: movementId });
  eq('movement deleted', data.days[today].movements.length, 0);

  data = applyAction(data, { type: 'task/add', date: today, title: '   ' });
  eq('a blank task is rejected', data.days[today].tasks.length, 0);
  data = applyAction(data, { type: 'task/add', date: today, title: '  Reply to the studio  ' });
  eq('task titles are trimmed', data.days[today].tasks[0].title, 'Reply to the studio');
  const taskId = data.days[today].tasks[0].id;
  data = applyAction(data, { type: 'task/update', date: today, id: taskId, patch: { title: 'Reply to the studio today' } });
  eq('a task can be renamed', data.days[today].tasks[0].title, 'Reply to the studio today');
  data = applyAction(data, { type: 'task/toggle', date: today, id: taskId });
  eq('completing sets the flag', data.days[today].tasks[0].done, true);
  check('completing stamps the time', typeof data.days[today].tasks[0].doneAt === 'string');
  data = applyAction(data, { type: 'task/remove', date: today, id: taskId });
  eq('a task can be deleted', data.days[today].tasks.length, 0);

  const tag1 = applyAction(data, { type: 'settings/addTag', tag: 'Proofing' });
  eq('tag added', tag1.settings.tags.includes('Proofing'), true);
  eq('duplicate tag ignored', applyAction(tag1, { type: 'settings/addTag', tag: 'Proofing' }), tag1);
  const tag2 = applyAction(tag1, { type: 'settings/removeTag', tag: 'Proofing' });
  eq('tag removed', tag2.settings.tags.includes('Proofing'), false);

  const custom = applyAction(data, { type: 'timer/set', patch: { customMinutes: 47, mode: 'custom' } });
  eq('the custom length is stored', custom.timer.customMinutes, 47);

  /* ------------------------------------------------------------- notes */

  eq('a document starts with no notes', data.notes.length, 0);
  const addedNote = applyAction(data, { type: 'note/add', id: 'note_a', title: 'Ship', html: '' });
  eq('a note can be created with a title', addedNote.notes[0].title, 'Ship');
  const withNote = applyAction(addedNote, {
    type: 'note/set',
    id: 'note_a',
    html: '<p><strong>Ship</strong> the <em>redesign</em>.</p>',
  });
  eq('the note is stored', withNote.notes[0].html, '<p><strong>Ship</strong> the <em>redesign</em>.</p>');
  check('the note is stamped when it changes', withNote.notes[0].updatedAt !== addedNote.notes[0].updatedAt);
  const renamedNote = applyAction(withNote, { type: 'note/rename', id: 'note_a', title: 'Launch' });
  eq('a note can be renamed', renamedNote.notes[0].title, 'Launch');
  const updatedNote = applyAction(renamedNote, { type: 'note/update', id: 'note_a', patch: { title: 'Launch day', html: '<p>Ready.</p>' } });
  eq('title and body save together', `${updatedNote.notes[0].title}:${updatedNote.notes[0].html}`, 'Launch day:<p>Ready.</p>');
  eq('the note stays out of the day records', withNote.days[today]?.note ?? '', '');
  const hugeNote = applyAction(addedNote, { type: 'note/set', id: 'note_a', html: 'x'.repeat(NOTE_HTML_MAX + 10) });
  eq('the note is clamped at the boundary', hugeNote.notes[0].html.length, NOTE_HTML_MAX);
  const erasedNote = applyAction(withNote, { type: 'data/reset', seed: false });
  eq('erasing data clears the note library', erasedNote.notes.length, 0);

  const reseeded = applyAction(data, { type: 'data/reset', seed: true });
  check('reset with seed produces a back catalogue', Object.keys(reseeded.days).length > 50);
  eq('reset anchors the rolling list', reseeded.meta.tasksStartAt, today);
  const emptied = applyAction(reseeded, { type: 'data/reset', seed: false });
  eq('reset without seed leaves an empty document', Object.keys(emptied.days).length, 0);

  /* ------------------------------------------------------------- the name */

  eq('a document starts with no name', data.profile, undefined);
  const named = applyAction(data, { type: 'profile/set-name', name: '  Ada   Lovelace  ' });
  eq('the name is trimmed and spaced', named.profile?.name, 'Ada Lovelace');
  check('the moment it was given is recorded', typeof named.profile?.createdAt === 'string');
  eq('saving a name completes the greeting', named.onboarding?.completed, true);
  eq('at the current payload version', named.onboarding?.version, ONBOARDING_VERSION);

  const renamed = applyAction(named, { type: 'profile/set-name', name: 'Ada King' });
  eq('the name can be changed later', renamed.profile?.name, 'Ada King');
  eq('and keeps the original moment', renamed.profile?.createdAt, named.profile?.createdAt);

  // Nothing the interface would refuse may reach the document.
  eq('an empty name is refused', applyAction(data, { type: 'profile/set-name', name: '   ' }), data);
  eq('digits are refused', applyAction(data, { type: 'profile/set-name', name: 'Agent 47' }), data);
  eq('a name that is too long is refused', applyAction(data, { type: 'profile/set-name', name: 'x'.repeat(NAME_MAX + 1) }), data);
  eq(
    'punctuation the rule allows is accepted',
    applyAction(data, { type: 'profile/set-name', name: "Seán O'Brien-Wells Jr." }).profile?.name,
    "Seán O'Brien-Wells Jr.",
  );

  // Erasing the history is not the same as forgetting who the owner is.
  const erased = applyAction(named, { type: 'data/reset', seed: false });
  eq('erasing keeps the name', erased.profile?.name, 'Ada Lovelace');
  eq('erasing keeps the greeting answered', erased.onboarding?.completed, true);
  eq('but throws the days away', Object.keys(erased.days).length, 0);
}

/* ------------------------------------------------------------------ *
 * 4. Action validation (the IPC boundary)
 * ------------------------------------------------------------------ */

describe('Action validation at the IPC boundary');
{
  eq('unknown action rejected', sanitizeAction({ type: 'data/nuke' }), null);
  eq('non-object rejected', sanitizeAction('drop table'), null);
  eq('bad date key rejected', sanitizeAction({ type: 'task/add', date: 'yesterday', title: 'x' }), null);
  eq('removed carry-over action rejected', sanitizeAction({ type: 'task/carryOver', date: today }), null);
  const setName = sanitizeAction({ type: 'profile/set-name', name: `  Ada${'a'.repeat(80)}  ` }) as { name: string };
  eq('a name from the renderer is trimmed and clamped', setName.name.length, NAME_MAX);
  eq('the clamp keeps the start of the name', setName.name.slice(0, 4), 'Adaa');
  const wrongType = sanitizeAction({ type: 'profile/set-name', name: 42 }) as { name: string } | null;
  eq('a name of the wrong type survives validation nowhere', wrongType?.name, '');
  eq('removed reorder action rejected', sanitizeAction({ type: 'task/reorder', date: today, ids: [] }), null);
  eq('a legacy day-note action is still rejected', sanitizeAction({ type: 'note/set', date: today, note: 'x' }), null);
  eq('removed day-clear action rejected', sanitizeAction({ type: 'day/clear', date: today }), null);
  const noteAction = sanitizeAction({ type: 'note/set', id: 'note_a', html: '<p>Hello</p>' }) as { html: string };
  eq('the Home note action passes validation', noteAction.html, '<p>Hello</p>');
  eq('a non-string note body is rejected', sanitizeAction({ type: 'note/set', id: 'note_a', html: 42 }), null);
  const longNote = sanitizeAction({ type: 'note/set', id: 'note_a', html: 'x'.repeat(NOTE_HTML_MAX + 10) }) as { html: string };
  eq('a note from the renderer is clamped', longNote.html.length, NOTE_HTML_MAX);

  const long = sanitizeAction({ type: 'task/add', date: today, title: 'x'.repeat(900) }) as { title: string };
  eq('task title clamped', long.title.length, 200);
  eq('a blank title is rejected', sanitizeAction({ type: 'task/add', date: today, title: '   ' }), null);

  const patch = sanitizeAction({ type: 'task/update', date: today, id: 'a', patch: { title: 'y'.repeat(400), id: 'hijack', createdAt: '1999-01-01' } }) as {
    patch: { title: string; id?: string; createdAt?: string };
  };
  eq('task title clamped on update', patch.patch.title.length, 200);
  eq('an update cannot hijack the id', patch.patch.id, undefined);
  eq('an update cannot rewrite createdAt', patch.patch.createdAt, undefined);

  const ses = sanitizeAction({ type: 'session/add', date: today, session: { minutes: 99999, tag: 'x'.repeat(80) } }) as {
    session: { minutes: number; tag: string; startedAt: string };
  };
  eq('absurd session length clamped', ses.session.minutes, 1440);
  eq('session tag clamped', ses.session.tag.length, 24);
  check('missing startedAt defaulted', typeof ses.session.startedAt === 'string');

  const timer = sanitizeAction({ type: 'timer/set', patch: { customMinutes: 99_999, mode: 'nonsense', tag: 'z'.repeat(50) } }) as {
    patch: { customMinutes: number; mode?: string; tag: string };
  };
  eq('custom length clamped to ten hours', timer.patch.customMinutes, 600);
  eq('an impossible timer mode is dropped', timer.patch.mode, undefined);
  eq('timer tag clamped', timer.patch.tag.length, 24);
}

/* ------------------------------------------------------------------ *
 * 5. Statistics
 * ------------------------------------------------------------------ */

describe('Statistics');
{
  const goals = { deepWorkMin: 240, movementMin: 45, tasks: 5 };

  // Totals and the composite score (the average of three capped ratios).
  let data = defaultData();
  data = applyAction(data, { type: 'session/add', date: today, session: { tag: 'Studio', startedAt: `${today}T09:00:00`, minutes: 120 } });
  data = applyAction(data, { type: 'session/add', date: today, session: { tag: 'Invoices', startedAt: `${today}T14:00:00`, minutes: 60 } });
  data = applyAction(data, { type: 'movement/add', date: today, entry: { type: 'run', minutes: 45, intensity: 3, at: `${today}T07:00:00` } });
  for (let i = 0; i < 5; i++) {
    data = applyAction(data, { type: 'task/add', date: today, title: `Task ${i}` });
    data = applyAction(data, { type: 'task/toggle', date: today, id: data.days[today].tasks[i].id });
  }
  const totals = totalsFor(data, today);
  eq('focus minutes summed from sessions', totals.focusMin, 180);
  eq('movement minutes summed', totals.movementMin, 45);
  eq('completed tasks counted', totals.tasksDone, 5);
  eq('sessions counted', totals.sessions, 2);
  eq('nothing means zero', totalsFor(data, addDays(today, -5)).focusMin, 0);

  const cappedTotals = totalsFor(
    applyAction(
      applyAction(data, { type: 'session/add', date: today, session: { tag: 'Extra', startedAt: `${today}T20:00:00`, minutes: 600 } }),
      { type: 'movement/add', date: today, entry: { type: 'gym', minutes: 300, intensity: 4, at: `${today}T21:00:00` } },
    ),
    today,
  );
  eq('the score caps each ratio at 100%', cappedTotals.score, 100);

  // Heat levels: 0, ≤25%, ≤50%, <100%, done.
  eq('nothing logged is level 0', levelFor(0), 0);
  eq('a tenth of the goal is level 1', levelFor(0.1), 1);
  eq('exactly a quarter is still level 1', levelFor(0.25), 1);
  eq('a third of the goal is level 2', levelFor(0.33), 2);
  eq('just over half is level 3', levelFor(0.51), 3);
  eq('almost there is still level 3', levelFor(0.99), 3);
  eq('the goal met is level 4', levelFor(1), 4);
  eq('beating the goal stays level 4', levelFor(2.5), 4);

  const ratio = ratioFor({ ...totals, focusMin: 120 }, goals, 'focus');
  eq('the focus filter measures against the focus goal', Math.round(ratio * 100), 50);
  eq('the combined filter reports the score', ratioFor({ ...totals, score: 49 }, goals, 'combined'), 0.49);

  // A year of heat, with a session sitting in the future: it must be ignored.
  let heat = defaultData();
  heat = applyAction(heat, { type: 'session/add', date: today, session: { tag: 'Studio', startedAt: `${today}T09:00:00`, minutes: 240 } });
  heat = applyAction(heat, { type: 'session/add', date: addDays(today, 3), session: { tag: 'Studio', startedAt: `${addDays(today, 3)}T09:00:00`, minutes: 600 } });
  const grid = heatGrid(heat, 'combined', today);
  eq('the heatmap has seven rows', grid.rows.length, 7);
  eq('and fifty-three week columns', grid.rows[0].length, 53);
  eq('the last cell of today’s row is today', grid.rows[(new Date(`${today}T00:00:00`).getDay() + 6) % 7][52].key, today);
  const flat = grid.rows.flat();
  check('nothing after today is ever drawn as a real cell', flat.every((c) => c.key <= grid.to || (c.future && c.level === 0)), flat.filter((c) => c.key > grid.to).length);
  const focusGrid = heatGrid(heat, 'focus', today);
  eq('meeting a goal is the top level', focusGrid.rows.flat().find((c) => c.key === today)?.level, 4);
  eq('the future session colours nothing', focusGrid.rows.flat().filter((c) => !c.future && c.level === 4).length, 1);
  eq('one active day in the window', grid.activeDays, 1);
  check('the month axis is labelled', grid.months.length >= 11 && grid.months.length <= 13, grid.months.map((m) => m.label));

  // Charts: no future bars, and the ranges are the ranges.
  const bars30 = focusBars(heat, '30D', today);
  eq('30D has thirty bars', bars30.length, 30);
  eq('the last 30D bar is today', bars30[bars30.length - 1].key, today);
  check('no 30D bar is in the future', bars30.every((b) => b.key <= today));
  check('today’s bar is marked', bars30[bars30.length - 1].isToday === true);
  eq('today’s bar carries the minutes', bars30[bars30.length - 1].value, 240);
  const bars12w = focusBars(heat, '12W', today);
  eq('12W has twelve bars', bars12w.length, 12);
  check('no 12W bar includes a future day', bars12w.every((b) => b.key <= today));
  eq('this week totals the sessions inside it', bars12w[11].value, 240);
  const bars1y = focusBars(heat, '1Y', today);
  eq('1Y has twelve bars', bars1y.length, 12);
  eq('the current month bar totals its sessions', bars1y[11].value, 240);

  // Tags.
  let tagged = defaultData();
  tagged = applyAction(tagged, { type: 'session/add', date: today, session: { tag: 'Studio', startedAt: `${today}T09:00:00`, minutes: 60 } });
  tagged = applyAction(tagged, { type: 'session/add', date: today, session: { tag: 'Studio', startedAt: `${today}T11:00:00`, minutes: 30 } });
  tagged = applyAction(tagged, { type: 'session/add', date: today, session: { tag: 'Invoices', startedAt: `${today}T13:00:00`, minutes: 20 } });
  tagged = applyAction(tagged, { type: 'session/add', date: today, session: { tag: '   ', startedAt: `${today}T15:00:00`, minutes: 15 } });
  tagged = applyAction(tagged, { type: 'session/add', date: addDays(today, 5), session: { tag: 'Future', startedAt: `${addDays(today, 5)}T09:00:00`, minutes: 600 } });
  const tags = tagBars(tagged, '30D', today);
  eq('tags are summed and sorted', tags[0].tag, 'Studio');
  eq('with their minutes', tags[0].minutes, 90);
  eq('untagged work gets a plain label', tags.some((t) => t.tag === 'No tag'), true);
  check('work in the future is never counted', !tags.some((t) => t.tag === 'Future'));

  // A long history for the rolling figures, using applyAction so goals apply.
  let history = defaultData();
  for (let i = 41; i >= 0; i--) {
    const key = addDays(today, -i);
    history = applyAction(history, {
      type: 'session/add',
      date: key,
      session: { tag: 'Studio', startedAt: `${key}T09:00:00`, minutes: 60 + (i % 3) * 45 },
    });
  }
  history = applyAction(history, { type: 'session/add', date: addDays(today, 2), session: { tag: 'Studio', startedAt: `${addDays(today, 2)}T09:00:00`, minutes: 900 } });
  const figures = statFigures(history, 'focus', today);
  const weekStart = startOfWeek(today, 1);
  let expectedWeek = 0;
  for (let key = weekStart; key <= today; key = addDays(key, 1)) {
    expectedWeek += totalsFor(history, key).focusMin;
  }
  eq('this week’s total covers the week so far', figures.weekMin, expectedWeek);
  check('the 30-day average is a per-day figure', figures.averagePerDay > 0 && figures.averagePerDay < 400, figures.averagePerDay);
  check('the best day is never in the future', figures.best !== null && figures.best.key <= today, figures.best);
  eq('the best day is the busiest real day', figures.best?.focusMin, 150);
  check('the average counts quiet days too', figures.averagePerDay < 150, figures.averagePerDay);

  eq('an insight line needs four weeks of history', bestWeekdayLine(defaultData(), today), null);
  check('and appears once there is', typeof bestWeekdayLine(history, today) === 'string');
  check('the insight names a weekday', /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/.test(bestWeekdayLine(history, today) ?? ''));
}

/* ------------------------------------------------------------------ *
 * 6. Streaks
 * ------------------------------------------------------------------ */

describe('Streaks and grace days');
{
  const goals = { deepWorkMin: 240, movementMin: 45, tasks: 5 };

  // Four clean weeks ending yesterday, with controlled blanks inside them.
  const lastMonday = addDays(startOfWeek(today, 1), -7);
  const build = (blanks: string[]) => {
    const out: Record<string, DayRecord> = {};
    for (let i = 28; i >= 1; i--) {
      const key = addDays(today, -i);
      out[key] = blanks.includes(key) ? blankDay(key) : dayWith([250], [50], 5, key);
    }
    return out;
  };

  const clean = build([]);
  const oneMiss = build([lastMonday]);
  const twoMisses = build([lastMonday, addDays(lastMonday, 2)]);
  const missed = streakFor(dataWithDays(oneMiss), 'focus', today);
  const doubled = streakFor(dataWithDays(twoMisses), 'focus', today);
  eq('twenty-eight clean days counted', streakFor(dataWithDays(clean), 'focus', today).current, 28);
  eq('one blank day is forgiven by the grace day', missed.current, 27);
  check('a second miss in the same week ends the run', doubled.current < missed.current, { doubled: doubled.current, missed: missed.current });
  check('the longest run is at least the current run', missed.longest >= missed.current);

  const withEmptyToday = { ...clean, [today]: blankDay(today) };
  eq('an unfinished today does not break the run', streakFor(dataWithDays(withEmptyToday), 'focus', today).current, 28);
  const withGoodToday = { ...clean, [today]: dayWith([250], [50], 5) };
  eq('meeting today adds one', streakFor(dataWithDays(withGoodToday), 'focus', today).current, 29);

  // The filter decides what counts: a focus-only history never meets the
  // movement or task goals, however good it looks.
  const focusOnly: Record<string, DayRecord> = {};
  for (let i = 3; i >= 1; i--) focusOnly[addDays(today, -i)] = dayWith([250], [], 5, addDays(today, -i));
  eq('a goal that was never met has no run', streakFor(dataWithDays(focusOnly), 'movement', today).current, 0);
  eq('while the goal that was met does', streakFor(dataWithDays(focusOnly), 'focus', today).current, 3);

  const solid: Record<string, DayRecord> = {};
  for (let i = 0; i < 20; i++) solid[addDays(today, -i)] = dayWith([300], [60], 6, addDays(today, -i));
  const solidStreak = streakFor(dataWithDays(solid), 'movement', today);
  eq('20 clean movement days counted', solidStreak.current, 20);
  eq('longest matches', solidStreak.longest, 20);
  eq('the task goal counts completed tasks', streakFor(dataWithDays(solid), 'tasks', today).current, 20);
  const solidData = dataWithDays(solid);
  const strict: DaybookData = { ...solidData, settings: { ...solidData.settings, goals: { ...goals, tasks: 10 } } };
  eq('the goals come from the document, not from constants', streakFor(strict, 'tasks', today).current, 0);
}

/* ------------------------------------------------------------------ *
 * 7. Formatting
 * ------------------------------------------------------------------ */

describe('Formatting');
{
  eq('minutes only', formatMinutes(45), '45m');
  eq('a whole hour pads the minutes', formatMinutes(120), '2h 00m');
  eq('hours and minutes', formatMinutes(145), '2h 25m');
  eq('nothing', formatMinutes(0), '0m');
  eq('negative input never prints nonsense', formatMinutes(-30), '0m');
  eq('axis labels stay compact', formatMinutesShort(45), '45m');
  eq('whole hours drop the minutes on axes', formatMinutesShort(120), '2h');
  eq('fractional hours on axes', formatMinutesShort(90), '1.5h');
  eq('singular', count(1, 'day'), '1 day');
  eq('plural', count(2, 'day'), '2 days');
  eq('zero is plural', count(0, 'task'), '0 tasks');
  eq('irregular plurals', count(2, 'entry', 'entries'), '2 entries');
  eq('noun only', noun(1, 'session'), 'session');
  eq('noun only, plural', noun(3, 'session'), 'sessions');
}

/* ------------------------------------------------------------------ *
 * 7b. Names
 * ------------------------------------------------------------------ */

describe('Names');
{
  eq('repeated spaces collapse', cleanName('  Ada    Lovelace  '), 'Ada Lovelace');
  eq('tabs and newlines count as spaces', cleanName('Ada\n\tLovelace'), 'Ada Lovelace');
  eq('only whitespace is nothing', cleanName('   '), '');
  eq('a non-string is nothing', cleanName(42), '');
  eq('a hyphenated name is fine', nameError('Ada Lovelace-Wells'), null);
  eq('an apostrophe is fine', nameError("Seán O'Brien"), null);
  eq('a typographic apostrophe is fine', nameError('Seán O’Brien'), null);
  eq('a full stop is fine', nameError('Ada L. Wells'), null);
  eq('capitals inside a name are fine', nameError('van der Berg'), null);
  eq('accented and non-Latin letters are fine', nameError('李 Wei'), null);
  eq('the shortest name is one letter', nameError('A'), null);
  eq(`the longest is ${NAME_MAX}`, nameError('a'.repeat(NAME_MAX)), null);
  check(`one more than ${NAME_MAX} is refused`, nameError('a'.repeat(NAME_MAX + 1)) !== null);
  check('an empty name asks for one', /enter a name/i.test(nameError('') ?? ''));
  check('digits are refused', nameError('Agent 47') !== null);
  check('a slash is refused', nameError('Ada/Lovelace') !== null);
  check('a colon is refused', nameError('Ada: the sequel') !== null);
  check('punctuation alone is refused', nameError('...') !== null);
  check('a name that starts with punctuation is refused', nameError('- Ada') !== null);
  check('every message reads as a sentence', (nameError('Agent 47') ?? '').endsWith('.'));
  // A single emoji is one character: counted in UTF-16 units, 24 of them would
  // be 48 and the wrong message would come back.
  eq('names are counted in characters, not UTF-16 units', nameError('👍'.repeat(NAME_MAX)), 'Letters, spaces, hyphens, apostrophes and full stops only.');
  eq('and the limit is that many of them', nameError('👍'.repeat(NAME_MAX + 1)), `A name can be up to ${NAME_MAX} characters.`);
}

/* ------------------------------------------------------------------ *
 * 8. Date helpers
 * ------------------------------------------------------------------ */

describe('Date helpers');
{
  eq('week starts on Monday', startOfWeek('2026-10-07', 1), '2026-10-05');
  eq('week can start on Sunday where asked', startOfWeek('2026-10-07', 0), '2026-10-04');
  eq('crossing a DST boundary keeps the calendar honest', addDays('2026-03-28', 2), '2026-03-30');
  eq('adding a day rolls the month', addDays('2026-01-31', 1), '2026-02-01');
  eq('month arithmetic clamps short months', addMonths('2026-01-31', 1), '2026-02-28');
}

/* ------------------------------------------------------------------ *
 * 9. Seed generator
 * ------------------------------------------------------------------ */

describe('Seed generator');
{
  const days = generateSeedDays(today);
  const keys = Object.keys(days).sort();
  check('seven to nine weeks of back catalogue', keys.length >= 50 && keys.length <= 60, keys.length);
  check('the newest entries reach today', keys[keys.length - 1] === today);
  check('every day has a date field matching its key', keys.every((k) => days[k].date === k));
  const sessions = Object.values(days).flatMap((d) => d.sessions);
  check('a realistic number of sessions', sessions.length > 60, sessions.length);
  check('no session is shorter than 20 minutes or longer than 4 hours', sessions.every((s) => s.minutes >= 20 && s.minutes <= 240));
  check('no day has an implausible pile of sessions', Object.values(days).every((d) => d.sessions.length <= 6));
  check(
    'sessions land between 06:00 and 20:00',
    sessions.every((s) => {
      const h = new Date(s.startedAt).getHours();
      return h >= 6 && h <= 20;
    }),
  );
  check('task priorities are one of A/B/C', Object.values(days).flatMap((d) => d.tasks).every((t) => ['A', 'B', 'C'].includes(t.priority)));

  const same = generateSeedDays(today);
  /** Timestamps come from the wall clock (by design); everything else must match. */
  const shape = (data: Record<string, DayRecord>) =>
    JSON.stringify(
      Object.keys(data)
        .sort()
        .map((key) => ({
          key,
          sessions: data[key].sessions.map((s) => ({ tag: s.tag, minutes: s.minutes, hour: new Date(s.startedAt).getHours() })),
          movements: data[key].movements.map((m) => ({ type: m.type, minutes: m.minutes, intensity: m.intensity })),
          tasks: data[key].tasks.map((t) => ({ title: t.title, priority: t.priority, done: t.done, order: t.order })),
          note: data[key].note,
        })),
    );
  eq('seeding is deterministic for a given day', JSON.stringify(Object.keys(same).sort()), JSON.stringify(keys));
  eq('and repeats the same edition exactly', shape(same), shape(days));
}

/* ------------------------------------------------------------------ *
 * 10. Storage: atomic writes, pre-migration copies, backups, recovery
 * ------------------------------------------------------------------ */

describe('Storage');
{
  const dir = path.join(tmpDir, 'store');
  fs.mkdirSync(dir, { recursive: true });
  const store = new Storage(dir, '1.1.0');
  eq('fresh storage starts empty', Object.keys(store.get().days).length, 0);

  // Five distinct saves → five rolling backups.
  for (let i = 0; i < 6; i++) {
    const next = applyAction(store.get(), { type: 'task/add', date: today, title: `Task ${i}` });
    store.set(next);
    store.flush();
  }
  const backups = store.listBackups();
  eq('exactly five rolling backups are kept', backups.filter((b) => b.name.startsWith('daybook.')).length, 5);
  check(
    'backups are numbered oldest last',
    backups
      .filter((b) => b.name.startsWith('daybook.'))
      .map((b) => b.name)
      .join(',') === 'daybook.1.json,daybook.2.json,daybook.3.json,daybook.4.json,daybook.5.json',
    backups.map((b) => b.name),
  );
  check('no leftover temp files', fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')).length === 0);

  // Identical snapshots must not evict a useful restore point.
  const sameAgain = store.get();
  store.set(sameAgain);
  store.flush();
  store.set(sameAgain);
  store.flush();
  eq('identical saves do not churn the backup window', store.listBackups().filter((b) => b.name.startsWith('daybook.')).length, 5);

  const reread = new Storage(dir);
  eq('data round-trips through the file', reread.get().days[today].tasks.length, 6);

  // A v1 file on disk is copied aside before the migration rewrites anything.
  const upgradeDir = path.join(tmpDir, 'upgrade');
  fs.mkdirSync(upgradeDir, { recursive: true });
  const v1Text = JSON.stringify(
    {
      version: 1,
      createdAt: '2026-02-02T09:00:00.000Z',
      days: { '2026-02-01': { date: '2026-02-01', note: 'kept', sessions: [{ id: 'x', tag: 'Studio', startedAt: '2026-02-01T09:00:00Z', minutes: 90 }], movements: [], tasks: [] } },
      settings: { goals: { deepWorkMin: 300 }, tickSound: true },
      timer: { mode: 'focus', running: false, remainingMs: 0, round: 0, completed: 0 },
      meta: { launches: 3, lastOpenedAt: '2026-02-02T09:00:00Z', seeded: false },
    },
    null,
    2,
  );
  fs.writeFileSync(path.join(upgradeDir, 'daybook.json'), v1Text, 'utf8');
  const upgraded = new Storage(upgradeDir, '1.1.0');
  check('a pre-migration copy is written', typeof upgraded.preMigrationBackup === 'string' && fs.existsSync(upgraded.preMigrationBackup!), upgraded.preMigrationBackup);
  check('the copy keeps the old name convention', path.basename(upgraded.preMigrationBackup!).startsWith('pre-1.1.0-'));
  eq('the copy is byte-for-byte the old file', fs.readFileSync(upgraded.preMigrationBackup!, 'utf8'), v1Text);
  eq('the live document is migrated', upgraded.get().version, DATA_VERSION);
  eq('and no history was lost in the move', upgraded.get().days['2026-02-01'].sessions[0].minutes, 90);
  eq('the v1 note is still there', upgraded.get().days['2026-02-01'].note, 'kept');

  // Once the app has saved the upgraded document, a later launch is a no-op.
  upgraded.set(applyAction(upgraded.get(), { type: 'meta/patch', patch: { launches: 4 } }));
  upgraded.flush();
  const reopened = new Storage(upgradeDir, '1.1.0');
  eq('a second launch takes no further copy', reopened.preMigrationBackup, null);
  eq('and the migrated document is what round-trips', reopened.get().version, DATA_VERSION);

  // Corrupt the live file: storage must fall back to the newest good backup.
  const corruptDir = path.join(tmpDir, 'corrupt');
  fs.mkdirSync(corruptDir, { recursive: true });
  const source = new Storage(corruptDir, '1.1.0');
  source.set(applyAction(source.get(), { type: 'task/add', date: today, title: 'Recoverable' }));
  source.flush();
  fs.writeFileSync(path.join(corruptDir, 'daybook.json'), '{ this is not json', 'utf8');
  const recovered = new Storage(corruptDir, '1.1.0');
  check(
    'a corrupt live file recovers from a backup',
    Object.values(recovered.get().days).some((day) => day.tasks.some((t) => t.title === 'Recoverable')),
    Object.keys(recovered.get().days).length,
  );

  // Window geometry.
  const fallback = { width: 1360, height: 900, maximized: false };
  const state = recovered.readWindowState(fallback);
  eq('missing window state falls back to defaults', state.width, 1360);
  recovered.writeWindowState({ x: 40, y: 50, width: 1000, height: 700, maximized: true });
  const readBack = recovered.readWindowState(fallback);
  eq('window position remembered', readBack.x, 40);
  eq('maximised flag remembered', readBack.maximized, true);
  recovered.writeWindowState({ width: 10, height: 10, maximized: false });
  const clamped = recovered.readWindowState(fallback);
  check('absurd window sizes clamped to the minimum', clamped.width >= 1000 && clamped.height >= 600, clamped);
}

/* ------------------------------------------------------------------ *
 * 11. Pomodoro service
 * ------------------------------------------------------------------ */

describe('Pomodoro service');
{
  const dir = path.join(tmpDir, 'timer');
  fs.mkdirSync(dir, { recursive: true });
  const store = new Storage(dir, '1.1.0');
  const snapshots: TimerSnapshot[] = [];
  const completions: Array<{ mode: string; minutes: number }> = [];
  const service = new PomodoroService(store, {
    dispatch: (action: Action) => {
      const next = applyAction(store.get(), action);
      store.set(next);
      return next;
    },
    onTick: (snap) => snapshots.push(snap),
    onComplete: (info) => completions.push({ mode: info.mode, minutes: info.minutes }),
  });

  const logged = () => Object.values(store.get().days).flatMap((d) => d.sessions);

  eq('focus length comes from settings', service.totalMsFor('focus'), 25 * 60_000);
  eq('progress starts at zero', service.snapshot().progress, 0);

  service.command({ type: 'start' });
  const running = store.get().timer;
  check('starting sets an end timestamp', typeof running.endsAt === 'number' && running.endsAt > Date.now());
  check('starting records when the session began', typeof running.startedAt === 'number');

  // Simulate 10 minutes having passed: move the end time back ten minutes.
  store.set(applyAction(store.get(), { type: 'timer/set', patch: { endsAt: Date.now() + 15 * 60_000 } }));
  service.command({ type: 'pause' });
  const paused = store.get().timer;
  eq('pausing clears the end time', paused.endsAt, null);
  check('pausing keeps the remainder', Math.abs(paused.remainingMs - 15 * 60_000) < 1500, paused.remainingMs);

  service.command({ type: 'reset' });
  eq('reset restores the full length', store.get().timer.remainingMs, 25 * 60_000);
  eq('reset clears the run', store.get().timer.running, false);
  eq('reset clears the start stamp', store.get().timer.startedAt, null);

  // Ending a focus run early logs the time actually spent (if it is a minute).
  service.command({ type: 'setMode', mode: 'focus' });
  service.command({ type: 'start' });
  store.set(applyAction(store.get(), { type: 'timer/set', patch: { startedAt: Date.now() - 5 * 60_000 } }));
  const beforeSkip = logged().length;
  const roundBeforeSkip = store.get().timer.round;
  service.command({ type: 'skip' });
  const skipped = logged();
  eq('a skipped focus run logs the elapsed time', skipped.length, beforeSkip + 1);
  eq('logged at the elapsed length, not the configured one', skipped[skipped.length - 1]?.minutes, 5);
  eq('skipping advances to a break', store.get().timer.mode, 'short');
  eq('an early end does not consume a round', store.get().timer.round, roundBeforeSkip);
  eq('and announces the logged minutes', completions[completions.length - 1]?.minutes, 5);

  // A skip after a few seconds logs nothing at all.
  service.command({ type: 'setMode', mode: 'focus' });
  service.command({ type: 'start' });
  const beforeTiny = logged().length;
  service.command({ type: 'skip' });
  eq('a skip inside the first minute logs nothing', logged().length, beforeTiny);

  // A natural finish credits the scheduled length and starts the break.
  service.command({ type: 'setMode', mode: 'focus' });
  const roundBeforeFinish = store.get().timer.round;
  store.set(
    applyAction(store.get(), {
      type: 'timer/set',
      patch: { running: true, remainingMs: 20, endsAt: Date.now() + 20, startedAt: Date.now() - 25 * 60_000, tag: 'Studio' },
    }),
  );
  service.reconcile();
  await sleep(700);
  const afterFinish = store.get();
  const finished = Object.values(afterFinish.days).flatMap((d) => d.sessions).filter((s) => s.tag === 'Studio' && s.minutes === 25);
  eq('a finished focus session is logged once', finished.length, 1);
  eq('logged as automatic', finished[0]?.auto, true);
  eq('a short break follows', afterFinish.timer.mode, 'short');
  eq('and starts itself when configured', afterFinish.timer.running, true);
  eq('a full run consumes a round', afterFinish.timer.round, roundBeforeFinish + 1);
  eq('the last tag is remembered', afterFinish.settings.lastTag, 'Studio');
  eq('completion was announced to the shell', completions.length >= 1, true);
  service.command({ type: 'reset' });

  // Every fourth round rolls into a long break.
  store.set(
    applyAction(store.get(), {
      type: 'timer/set',
      patch: { mode: 'focus', round: 3, running: true, remainingMs: 15, endsAt: Date.now() + 15, startedAt: Date.now() - 25 * 60_000 },
    }),
  );
  service.reconcile();
  await sleep(700);
  eq('the fourth round takes a long break', store.get().timer.mode, 'long');
  eq('long break runs for the configured length', Math.round(store.get().timer.remainingMs / 60_000), 15);
  service.command({ type: 'reset' });

  // Custom mode: any length, remembered, logged, and back to the same ring.
  eq('custom length comes from the timer state', service.totalMsFor('custom'), 30 * 60_000);
  service.command({ type: 'setCustomMinutes', minutes: 47 });
  eq('the custom length is remembered', store.get().timer.customMinutes, 47);
  service.command({ type: 'setMode', mode: 'custom' });
  eq('custom mode uses the custom length', service.snapshot().totalMs, 47 * 60_000);
  service.command({ type: 'start' });
  store.set(applyAction(store.get(), { type: 'timer/set', patch: { startedAt: Date.now() - 12 * 60_000 } }));
  service.command({ type: 'stop' });
  const customLogged = Object.values(store.get().days).flatMap((d) => d.sessions).filter((s) => s.minutes === 12);
  eq('a stopped custom run logs its elapsed time', customLogged.length, 1);
  eq('custom mode stays custom', store.get().timer.mode, 'custom');
  eq('the ring is ready to run again', store.get().timer.remainingMs, 47 * 60_000);
  eq('and is not running', store.get().timer.running, false);
  eq('the custom completion was announced', completions[completions.length - 1]?.mode, 'custom');

  // Editing the lengths while idle re-derives the ring.
  service.command({ type: 'setMode', mode: 'focus' });
  service.command({ type: 'resync' });
  store.set(applyAction(store.get(), { type: 'settings/pomodoro', patch: { focusMin: 40 } }));
  service.command({ type: 'resync' });
  eq('a length change is picked up from the next session', store.get().timer.remainingMs, 40 * 60_000);
  store.set(applyAction(store.get(), { type: 'settings/pomodoro', patch: { focusMin: 25 } }));

  // A session that expired hours ago (app closed) is credited at schedule length.
  store.set(
    applyAction(store.get(), {
      type: 'timer/set',
      patch: { mode: 'focus', running: true, endsAt: Date.now() - 3 * 60 * 60_000, startedAt: Date.now() - 4 * 60 * 60_000, remainingMs: 0, tag: 'Overnight' },
    }),
  );
  service.reconcile();
  const overnight = Object.values(store.get().days).flatMap((d) => d.sessions).filter((s) => s.tag === 'Overnight');
  eq('an overdue session is credited once', overnight.length, 1);
  eq('credited at the scheduled length, not the whole absence', overnight[0]?.minutes, 25);
  eq('reconciliation rolls on to a break', store.get().timer.mode, 'short');
  eq('and the break follows the auto-start setting', store.get().timer.running, true);
  check('tick snapshots were emitted', snapshots.length > 0, snapshots.length);

  service.stopTicker();
}

/* ------------------------------------------------------------------ *
 * Done
 * ------------------------------------------------------------------ */

// Let any debounced save settle before the scratch directory goes away.
await sleep(500);
fs.rmSync(tmpDir, { recursive: true, force: true });

process.stdout.write(`\n${failures.length ? '\u001b[31m' : '\u001b[32m'}${passed} passed, ${failures.length} failed\u001b[0m\n`);
if (failures.length) {
  process.stdout.write('\nFailures:\n');
  for (const failure of failures) process.stdout.write(`  • ${failure}\n`);
  process.exit(1);
}

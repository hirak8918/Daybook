/**
 * The one reducer. It runs in the Electron main process (authoritative, then
 * persisted) and, optimistically, in the renderer (so the UI never waits on
 * IPC). Both sides import this exact file, so a replayed action always lands on
 * the same state.
 *
 * v2 removed the actions behind features that no longer exist (carry-over,
 * drag-to-reorder, priorities, daily notes, clearing a single day). The data
 * those features wrote is still in the document and is never rewritten.
 */

import {
  DATA_VERSION,
  DEFAULT_SETTINGS,
  DaybookData,
  DayRecord,
  FocusSession,
  Goals,
  MovementEntry,
  NOTE_HTML_MAX,
  NOTE_TITLE_MAX,
  NOTES_MAX,
  Note,
  ONBOARDING_VERSION,
  PomodoroConfig,
  Settings,
  Task,
  TimerState,
  emptyDay,
  structuredCloneSafe,
  uid,
} from './schema';
import type { MovementType } from './schema';
import { DateKey, toKey } from './date';
import { NAME_MAX, cleanName, nameError } from './name';
import { generateSeedDays } from './seed';

export type Action =
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'profile/set-name'; name: string }
  | { type: 'settings/goals'; patch: Partial<Goals> }
  | { type: 'settings/pomodoro'; patch: Partial<PomodoroConfig> }
  | { type: 'settings/addTag'; tag: string }
  | { type: 'settings/removeTag'; tag: string }
  | { type: 'note/add'; id: string; title?: string; html?: string }
  | { type: 'note/set'; id: string; html: string }
  | { type: 'note/rename'; id: string; title: string }
  | { type: 'note/update'; id: string; patch: { title?: string; html?: string } }
  | { type: 'note/remove'; id: string }
  | { type: 'session/add'; date: DateKey; session: Omit<FocusSession, 'id'> }
  | { type: 'session/remove'; date: DateKey; id: string }
  | { type: 'session/update'; date: DateKey; id: string; patch: Partial<Omit<FocusSession, 'id'>> }
  | { type: 'movement/add'; date: DateKey; entry: Omit<MovementEntry, 'id'> }
  | { type: 'movement/remove'; date: DateKey; id: string }
  | { type: 'movement/update'; date: DateKey; id: string; patch: Partial<Omit<MovementEntry, 'id'>> }
  | { type: 'task/add'; date: DateKey; title: string }
  | { type: 'task/update'; date: DateKey; id: string; patch: Partial<Omit<Task, 'id'>> }
  | { type: 'task/toggle'; date: DateKey; id: string }
  | { type: 'task/remove'; date: DateKey; id: string }
  | { type: 'timer/set'; patch: Partial<TimerState> }
  | { type: 'meta/patch'; patch: Partial<DaybookData['meta']> }
  | { type: 'data/replace'; data: DaybookData }
  | { type: 'data/reset'; seed: boolean };

function getDay(state: DaybookData, date: DateKey): DayRecord {
  return state.days[date] ?? emptyDay(date);
}

function withDay(state: DaybookData, date: DateKey, day: DayRecord): DaybookData {
  return { ...state, days: { ...state.days, [date]: day } };
}

function noteTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, NOTE_TITLE_MAX) || 'Untitled note' : 'Untitled note';
}

function nextStamp(previous: string): string {
  const parsed = Date.parse(previous);
  const now = Date.now();
  return new Date(Number.isFinite(parsed) && now <= parsed ? parsed + 1 : now).toISOString();
}

export function applyAction(state: DaybookData, action: Action): DaybookData {
  switch (action.type) {
    /* ---------------------------------------------------------- profile */

    // The Welcome screen and the Settings row both land here: the name is
    // normalised and validated once, and the document only ever holds a name
    // the interface would accept. A name that fails is not written at all.
    case 'profile/set-name': {
      const name = cleanName(action.name);
      if (nameError(name)) return state;
      return {
        ...state,
        profile: { name, createdAt: state.profile?.createdAt ?? new Date().toISOString() },
        onboarding: { completed: true, version: ONBOARDING_VERSION },
      };
    }

    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case 'settings/goals':
      return { ...state, settings: { ...state.settings, goals: { ...state.settings.goals, ...action.patch } } };

    case 'settings/pomodoro':
      return { ...state, settings: { ...state.settings, pomodoro: { ...state.settings.pomodoro, ...action.patch } } };

    case 'settings/addTag': {
      const tag = action.tag.trim().slice(0, 24);
      if (!tag || state.settings.tags.includes(tag) || state.settings.tags.length >= 12) return state;
      return { ...state, settings: { ...state.settings, tags: [...state.settings.tags, tag] } };
    }

    case 'settings/removeTag': {
      const tags = state.settings.tags.filter((t) => t !== action.tag);
      return {
        ...state,
        settings: { ...state.settings, tags, lastTag: state.settings.lastTag === action.tag ? (tags[0] ?? '') : state.settings.lastTag },
      };
    }

    case 'note/add': {
      const id = typeof action.id === 'string' && action.id ? action.id.slice(0, 80) : uid('note');
      if (state.notes.some((note) => note.id === id) || state.notes.length >= NOTES_MAX) return state;
      const now = new Date().toISOString();
      const note: Note = {
        id,
        title: noteTitle(action.title),
        html: typeof action.html === 'string' ? action.html.slice(0, NOTE_HTML_MAX) : '',
        createdAt: now,
        updatedAt: now,
      };
      return { ...state, notes: [note, ...state.notes] };
    }

    case 'note/set': {
      const existing = state.notes.find((note) => note.id === action.id);
      if (!existing) return state;
      const html = typeof action.html === 'string' ? action.html.slice(0, NOTE_HTML_MAX) : '';
      if (html === existing.html) return state;
      return {
        ...state,
        notes: state.notes.map((note) =>
          note.id === action.id ? { ...note, html, updatedAt: nextStamp(note.updatedAt) } : note,
        ),
      };
    }

    case 'note/rename': {
      const existing = state.notes.find((note) => note.id === action.id);
      if (!existing) return state;
      const title = noteTitle(action.title);
      if (title === existing.title) return state;
      return {
        ...state,
        notes: state.notes.map((note) =>
          note.id === action.id ? { ...note, title, updatedAt: nextStamp(note.updatedAt) } : note,
        ),
      };
    }

    case 'note/update': {
      const existing = state.notes.find((note) => note.id === action.id);
      if (!existing) return state;
      const title = action.patch?.title === undefined ? existing.title : noteTitle(action.patch.title);
      const html =
        action.patch?.html === undefined
          ? existing.html
          : typeof action.patch.html === 'string'
            ? action.patch.html.slice(0, NOTE_HTML_MAX)
            : existing.html;
      if (title === existing.title && html === existing.html) return state;
      return {
        ...state,
        notes: state.notes.map((note) =>
          note.id === action.id ? { ...note, title, html, updatedAt: nextStamp(note.updatedAt) } : note,
        ),
      };
    }

    case 'note/remove':
      return state.notes.some((note) => note.id === action.id)
        ? { ...state, notes: state.notes.filter((note) => note.id !== action.id) }
        : state;

    case 'session/add': {
      const day = getDay(state, action.date);
      const session = { ...action.session, id: uid('ses') };
      return withDay(state, action.date, { ...day, sessions: [...day.sessions, session] });
    }

    case 'session/update': {
      const day = getDay(state, action.date);
      return withDay(state, action.date, {
        ...day,
        sessions: day.sessions.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      });
    }

    case 'session/remove': {
      const day = getDay(state, action.date);
      return withDay(state, action.date, { ...day, sessions: day.sessions.filter((s) => s.id !== action.id) });
    }

    case 'movement/add': {
      const day = getDay(state, action.date);
      return withDay(state, action.date, { ...day, movements: [...day.movements, { ...action.entry, id: uid('mov') }] });
    }

    case 'movement/update': {
      const day = getDay(state, action.date);
      return withDay(state, action.date, {
        ...day,
        movements: day.movements.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      });
    }

    case 'movement/remove': {
      const day = getDay(state, action.date);
      return withDay(state, action.date, { ...day, movements: day.movements.filter((m) => m.id !== action.id) });
    }

    case 'task/add': {
      const day = getDay(state, action.date);
      const title = action.title.trim().slice(0, 200);
      if (!title) return state;
      const task: Task = {
        id: uid('tsk'),
        title,
        // Priorities were dropped from the interface in v2; the field stays so
        // older records keep their shape.
        priority: 'B',
        done: false,
        createdAt: new Date().toISOString(),
        order: day.tasks.length ? Math.max(...day.tasks.map((t) => t.order)) + 1 : 0,
      };
      return withDay(state, action.date, { ...day, tasks: [...day.tasks, task] });
    }

    case 'task/update': {
      const day = getDay(state, action.date);
      return withDay(state, action.date, {
        ...day,
        tasks: day.tasks.map((t) =>
          t.id === action.id
            ? { ...t, ...action.patch, title: action.patch.title ? action.patch.title.trim().slice(0, 200) : t.title }
            : t,
        ),
      });
    }

    case 'task/toggle': {
      const day = getDay(state, action.date);
      return withDay(state, action.date, {
        ...day,
        tasks: day.tasks.map((t) =>
          t.id === action.id ? { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : undefined } : t,
        ),
      });
    }

    case 'task/remove': {
      const day = getDay(state, action.date);
      return withDay(state, action.date, { ...day, tasks: day.tasks.filter((t) => t.id !== action.id) });
    }

    case 'timer/set':
      return { ...state, timer: { ...state.timer, ...action.patch } };

    case 'meta/patch':
      return { ...state, meta: { ...state.meta, ...action.patch } };

    case 'data/replace':
      return action.data;

    case 'data/reset': {
      const days = action.seed ? generateSeedDays(toKey(), state.settings) : {};
      // A fresh list starts today: anything seeded before this moment belongs to
      // the retired per-day editions and is not listed.
      return {
        version: DATA_VERSION,
        createdAt: new Date().toISOString(),
        settings: structuredCloneSafe(DEFAULT_SETTINGS),
        notes: [],
        days,
        timer: {
          mode: 'focus',
          running: false,
          endsAt: null,
          remainingMs: DEFAULT_SETTINGS.pomodoro.focusMin * 60_000,
          round: 0,
          tag: DEFAULT_SETTINGS.lastTag,
          startedAt: null,
          completed: 0,
          customMinutes: 30,
        },
        meta: { launches: state.meta.launches, lastOpenedAt: new Date().toISOString(), seeded: action.seed, tasksStartAt: toKey() },
        // The name is who the owner is, not what they tracked: erasing the
        // history must not ask them to introduce themselves all over again.
        ...(state.profile ? { profile: state.profile } : {}),
        onboarding: state.onboarding ?? { completed: Boolean(state.profile), version: ONBOARDING_VERSION },
      };
    }

    default:
      return state;
  }
}

export function isMovementType(value: string): value is MovementType {
  return ['run', 'gym', 'yoga', 'walk', 'sport', 'custom'].includes(value);
}

/* ------------------------------------------------------------------ *
 * Action validation (IPC hardening)
 * ------------------------------------------------------------------ */

const ACTION_TYPES = new Set<Action['type']>([
  'settings/update',
  'profile/set-name',
  'settings/goals',
  'settings/pomodoro',
  'settings/addTag',
  'settings/removeTag',
  'note/add',
  'note/set',
  'note/rename',
  'note/update',
  'note/remove',
  'session/add',
  'session/remove',
  'session/update',
  'movement/add',
  'movement/remove',
  'movement/update',
  'task/add',
  'task/update',
  'task/toggle',
  'task/remove',
  'timer/set',
  'meta/patch',
]);

/**
 * The renderer is sandboxed, but the main process still validates every message
 * that crosses the bridge: unknown action types are dropped, strings clamped.
 */
export function sanitizeAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object') return null;
  const action = raw as Record<string, unknown>;
  const type = action.type;
  if (typeof type !== 'string' || !ACTION_TYPES.has(type as Action['type'])) return null;

  const out: Record<string, unknown> = { ...action, type };
  if ('date' in out && typeof out.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) return null;

  if (type === 'task/add') {
    if (typeof out.title !== 'string' || !out.title.trim()) return null;
    out.title = out.title.slice(0, 200);
  }
  if (type === 'task/update' && out.patch && typeof out.patch === 'object') {
    const patch = out.patch as Record<string, unknown>;
    if (typeof patch.title === 'string') patch.title = patch.title.slice(0, 200);
    delete patch.id;
    delete patch.createdAt;
  }
  if (type === 'profile/set-name') {
    // Clamped and cleaned at the boundary too: the reducer is the authority, and
    // this is the only action the name ever arrives through.
    out.name = cleanName(out.name).slice(0, NAME_MAX);
  }
  if (type === 'settings/addTag' && typeof out.tag === 'string') out.tag = out.tag.slice(0, 24);
  if (type === 'settings/removeTag' && typeof out.tag === 'string') out.tag = out.tag.slice(0, 24);
  if (type === 'note/set') {
    if (typeof out.id !== 'string') return null;
    out.id = out.id.slice(0, 80);
    if (typeof out.html !== 'string') return null;
    out.html = out.html.slice(0, NOTE_HTML_MAX);
  }
  if (type === 'note/add') {
    if (typeof out.id !== 'string') return null;
    out.id = out.id.slice(0, 80);
    if (out.title !== undefined) out.title = noteTitle(out.title);
    if (out.html !== undefined) out.html = String(out.html).slice(0, NOTE_HTML_MAX);
  }
  if (type === 'note/rename') {
    if (typeof out.id !== 'string') return null;
    out.id = out.id.slice(0, 80);
    if (typeof out.title !== 'string') return null;
    out.title = noteTitle(out.title);
  }
  if (type === 'note/update') {
    if (typeof out.id !== 'string' || !out.patch || typeof out.patch !== 'object') return null;
    out.id = out.id.slice(0, 80);
    const patch = out.patch as Record<string, unknown>;
    if (patch.title !== undefined) patch.title = noteTitle(patch.title);
    if (patch.html !== undefined) patch.html = String(patch.html).slice(0, NOTE_HTML_MAX);
  }
  if (type === 'note/remove') {
    if (typeof out.id !== 'string') return null;
    out.id = out.id.slice(0, 80);
  }
  if (type === 'session/add' && out.session && typeof out.session === 'object') {
    const s = out.session as Record<string, unknown>;
    out.session = {
      tag: String(s.tag ?? 'Untitled').slice(0, 24),
      startedAt: typeof s.startedAt === 'string' ? s.startedAt : new Date().toISOString(),
      minutes: Math.min(24 * 60, Math.max(1, Math.round(Number(s.minutes) || 1))),
      auto: Boolean(s.auto),
    };
  }
  if (type === 'session/update' && out.patch && typeof out.patch === 'object') {
    const patch = out.patch as Record<string, unknown>;
    delete patch.id;
    if (patch.minutes !== undefined) patch.minutes = Math.min(24 * 60, Math.max(1, Math.round(Number(patch.minutes) || 1)));
    if (typeof patch.tag === 'string') patch.tag = patch.tag.slice(0, 24);
  }
  if (type === 'movement/add' && out.entry && typeof out.entry === 'object') {
    const m = out.entry as Record<string, unknown>;
    const kind = String(m.type ?? 'custom');
    out.entry = {
      type: (isMovementType(kind) ? kind : 'custom') as MovementType,
      label: typeof m.label === 'string' ? m.label.slice(0, 40) : undefined,
      minutes: Math.min(24 * 60, Math.max(1, Math.round(Number(m.minutes) || 1))),
      intensity: Math.min(5, Math.max(1, Math.round(Number(m.intensity) || 3))),
      at: typeof m.at === 'string' ? m.at : new Date().toISOString(),
    };
  }
  if (type === 'timer/set' && out.patch && typeof out.patch === 'object') {
    const patch = out.patch as Record<string, unknown>;
    if (patch.customMinutes !== undefined) {
      patch.customMinutes = Math.min(600, Math.max(1, Math.round(Number(patch.customMinutes) || 1)));
    }
    if (typeof patch.tag === 'string') patch.tag = patch.tag.slice(0, 24);
    if (patch.mode !== undefined && !['focus', 'short', 'long', 'custom'].includes(String(patch.mode))) delete patch.mode;
  }
  return out as unknown as Action;
}

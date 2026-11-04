/**
 * Daybook — data model, schema versioning and migrations.
 *
 * The entire app state lives in ONE versioned JSON document. It is persisted by
 * the Electron main process to %APPDATA%\Daybook\daybook.json (atomic write +
 * rolling backups). The renderer never touches the disk: it dispatches actions
 * through the whitelisted IPC bridge, and the same pure reducer runs on both
 * sides so the two processes cannot drift apart.
 *
 * v2 (Daybook 1.1.0) simplified the interface but never the history: the same
 * day records carry sessions, movement and tasks exactly as before. Two things
 * moved: `tasksStartAt` marks the day the single rolling to-do list began (older
 * open tasks stay in the file, untouched and unused, rather than flooding a
 * list the owner asked to keep calm), and the timer learned a `custom` mode.
 *
 * v3 (Daybook 1.2.0) added `profile` and `onboarding` for the Welcome screen.
 * Both are optional and purely additive: a document with no `profile.name` is
 * one that has never been greeted, which is exactly what the renderer looks at.
 *
 * v4 (Daybook 2.0.0) added the single rich-text note sheet that lives on Home.
 * It is one document-level field, not a per-day note: the sheet is a scratchpad
 * that stays put while the days change underneath it. The old per-day `note`
 * strings are still preserved untouched.
 */

import { toKey } from './date';
import { cleanName, nameError } from './name';

export const DATA_VERSION = 4;

/** The note sheet is a scratchpad, not an archive: cap the stored markup. */
export const NOTE_HTML_MAX = 200_000;

/** The Welcome payload's own version, so a future redesign can ask again. */
export const ONBOARDING_VERSION = 1;

/** The movement activities Daybook knows how to file. */
export const MOVEMENT_TYPES: MovementType[] = ['run', 'gym', 'yoga', 'walk', 'sport', 'custom'];

export type ThemeMode = 'system' | 'light' | 'dark';
export type Priority = 'A' | 'B' | 'C';
export type TimerMode = 'focus' | 'short' | 'long' | 'custom';
export type HabitKey = 'deepWork' | 'movement' | 'tasks';
export type MovementType = 'run' | 'gym' | 'yoga' | 'walk' | 'sport' | 'custom';

export interface FocusSession {
  id: string;
  /** Free-form tag, e.g. "Studio", "Invoices". */
  tag: string;
  /** ISO datetime the session began. */
  startedAt: string;
  /** Rounded to the nearest minute, minimum 1. */
  minutes: number;
  /** True when the session was logged automatically by the timer. */
  auto?: boolean;
}

export interface MovementEntry {
  id: string;
  type: MovementType;
  /** Used when type === 'custom'. */
  label?: string;
  minutes: number;
  /** Perceived effort, 1 (stroll) → 5 (all out). */
  intensity: number;
  at: string;
}

export interface Task {
  id: string;
  title: string;
  /** Kept from v1 for data compatibility; the list no longer shows priorities. */
  priority: Priority;
  done: boolean;
  doneAt?: string;
  createdAt: string;
  /** Sort order inside the day, ascending. Kept for data compatibility. */
  order: number;
  /** Set on tasks created by v1's carry-over; the concept is gone, data kept. */
  carriedFrom?: string;
}

export interface DayRecord {
  date: string;
  sessions: FocusSession[];
  movements: MovementEntry[];
  tasks: Task[];
  /** Daily note from v1's "Today's leader". Kept, no longer edited. */
  note: string;
}

export interface Goals {
  deepWorkMin: number;
  movementMin: number;
  tasks: number;
}

export interface PomodoroConfig {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  roundsBeforeLong: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  chimeSound: boolean;
}

export interface Settings {
  goals: Goals;
  pomodoro: PomodoroConfig;
  tags: string[];
  movementTypes: MovementType[];
  /** Always Monday in v2; kept so stored documents stay compatible. */
  weekStart: 0 | 1;
  theme: ThemeMode;
  minimizeToTray: boolean;
  startWithWindows: boolean;
  notifications: boolean;
  globalShortcut: string;
  globalShortcutEnabled: boolean;
  /** Always on in v2; kept so stored documents stay compatible. */
  graceDay: boolean;
  lastTag: string;
}

export interface TimerState {
  mode: TimerMode;
  running: boolean;
  /** Epoch ms when the current run ends. Authoritative while running. */
  endsAt: number | null;
  /** Remaining ms while paused. */
  remainingMs: number;
  /** Completed focus rounds inside the current cycle. */
  round: number;
  tag: string;
  /** Epoch ms the running focus/custom session started (for auto-logging). */
  startedAt: number | null;
  /** Monotonic count of completed sessions; used to key notifications. */
  completed: number;
  /** Last-used length of the Custom timer, in minutes. */
  customMinutes: number;
}

/** Who the day belongs to. Absent until the Welcome screen has been answered. */
export interface Profile {
  /** 1–24 characters; see lib/name for the rule. */
  name: string;
  /** ISO datetime the name was first saved. */
  createdAt: string;
}

export interface OnboardingState {
  /** True once a name has been saved; kept alongside the profile, derived from it. */
  completed: boolean;
  version: number;
}

/** The Home note sheet. HTML is produced by the editor's constrained schema. */
export interface NoteSheet {
  html: string;
  updatedAt: string;
}

export interface DaybookData {
  version: number;
  /** ISO datetime of first launch. */
  createdAt: string;
  settings: Settings;
  /** The single Home note. Empty until the owner writes something. */
  notes: NoteSheet;
  days: Record<string, DayRecord>;
  timer: TimerState;
  /** Absent until the owner has named themselves on the Welcome screen. */
  profile?: Profile;
  /** Written together with the profile. */
  onboarding?: OnboardingState;
  meta: {
    launches: number;
    lastOpenedAt: string;
    /** Set once the demo data has been seeded. */
    seeded: boolean;
    /**
     * Date key the single rolling to-do list began. Open tasks created before
     * it belong to the retired per-day editions: kept in the file, not listed.
     * null = every open task counts (fresh installs from v2 onwards).
     */
    tasksStartAt: string | null;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  goals: { deepWorkMin: 240, movementMin: 45, tasks: 5 },
  pomodoro: {
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    roundsBeforeLong: 4,
    autoStartBreaks: true,
    autoStartFocus: false,
    chimeSound: false,
  },
  tags: ['Studio', 'Invoices', 'Study', 'Reading'],
  movementTypes: ['run', 'gym', 'yoga', 'walk', 'sport'],
  weekStart: 1,
  theme: 'system',
  minimizeToTray: false,
  startWithWindows: false,
  notifications: true,
  globalShortcut: 'Control+Alt+P',
  globalShortcutEnabled: true,
  graceDay: true,
  lastTag: 'Studio',
};

export const DEFAULT_CUSTOM_MINUTES = 30;

export function emptyDay(date: string): DayRecord {
  return { date, sessions: [], movements: [], tasks: [], note: '' };
}

export function defaultTimer(): TimerState {
  return {
    mode: 'focus',
    running: false,
    endsAt: null,
    remainingMs: DEFAULT_SETTINGS.pomodoro.focusMin * 60_000,
    round: 0,
    tag: DEFAULT_SETTINGS.lastTag,
    startedAt: null,
    completed: 0,
    customMinutes: DEFAULT_CUSTOM_MINUTES,
  };
}

export function defaultData(now = new Date()): DaybookData {
  const iso = now.toISOString();
  return {
    version: DATA_VERSION,
    createdAt: iso,
    settings: structuredCloneSafe(DEFAULT_SETTINGS),
    notes: { html: '', updatedAt: iso },
    days: {},
    timer: defaultTimer(),
    meta: { launches: 0, lastOpenedAt: iso, seeded: false, tasksStartAt: null },
    onboarding: { completed: false, version: ONBOARDING_VERSION },
  };
}

/** structuredClone exists everywhere we run, but keep a fallback for safety. */
export function structuredCloneSafe<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone;
  if (typeof sc === 'function') return sc(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ *
 * Migrations
 * ------------------------------------------------------------------ */

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated FROM. Each entry lifts the document one
 * version forward. Add new entries here and bump DATA_VERSION; old data files
 * keep working forever.
 *
 * The main process copies the raw file to backups/pre-<version>-<timestamp>.json
 * before `migrate` is ever called, so a migration is always reversible.
 */
const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: no released v0, but files hand-edited from the prototype may exist.
  0: (data) => ({ ...data, version: 1 }),

  // 1 → 2 (Daybook 1.1.0): four tabs, one rolling to-do list, custom timer.
  // Nothing is removed: sessions, movement, tasks, goals and notes all survive.
  // The per-day task lists are left exactly as they are; from today the rolling
  // list only considers tasks created from now on, so a v1 back catalogue of
  // open items cannot flood it.
  1: (data) => {
    const settings = (data.settings ?? {}) as Record<string, unknown>;
    const timer = (data.timer ?? {}) as Record<string, unknown>;
    const meta = (data.meta ?? {}) as Record<string, unknown>;
    const customMinutes = Number(timer.customMinutes);
    return {
      ...data,
      version: 2,
      settings: {
        ...settings,
        // The grace day is always on in v2; weeks always start on Monday.
        graceDay: true,
        weekStart: 1,
      },
      timer: {
        ...timer,
        customMinutes: Number.isFinite(customMinutes)
          ? Math.min(600, Math.max(1, Math.round(customMinutes)))
          : DEFAULT_CUSTOM_MINUTES,
      },
      meta: {
        ...meta,
        tasksStartAt: typeof meta.tasksStartAt === 'string' ? meta.tasksStartAt : toKey(),
      },
    };
  },

  // 2 → 3 (Daybook 1.2.0): the Welcome screen, which asks for a name once.
  // Deliberately writes nothing: the screen is shown when the document has no
  // `profile.name`, so inventing one here would rob upgrading owners of the one
  // greeting they are owed. Everything else about the document is untouched.
  2: (data) => ({ ...data, version: 3 }),

  // 3 → 4 (Daybook 2.0.0): the Home note sheet. Additive: the sanitizer below
  // gives older documents an empty sheet, and no history is rewritten.
  3: (data) => ({ ...data, version: 4 }),
};

/**
 * A stored name is only a name if the interface would have accepted it. Anything
 * else (a number, a blank string, a 4,000-character hand edit) is treated as "no
 * name yet" rather than shown back to the owner or written to the screen.
 */
function sanitizeProfile(raw: unknown, fallbackCreatedAt: string): Profile | undefined {
  const p = (raw ?? {}) as Record<string, unknown>;
  const name = cleanName(p.name);
  if (nameError(name)) return undefined;
  return {
    name,
    createdAt: typeof p.createdAt === 'string' && p.createdAt ? p.createdAt : fallbackCreatedAt,
  };
}

function sanitizeOnboarding(raw: unknown, hasProfile: boolean): OnboardingState {
  const o = (raw ?? {}) as Record<string, unknown>;
  const version = Math.round(Number(o.version));
  return {
    // Derived from the profile so the two can never contradict each other,
    // however the file was edited by hand.
    completed: hasProfile || o.completed === true,
    version: Number.isFinite(version) && version > 0 ? version : ONBOARDING_VERSION,
  };
}

/**
 * Rebuild settings from the defaults, taking only *known* keys from the stored
 * document and clamping them to sane ranges. New settings appear automatically
 * on upgrade; hand-edited or corrupted values can never poison the app, and no
 * unknown key is ever written back to disk.
 */
function mergeSettings(raw: unknown): Settings {
  const base = structuredCloneSafe(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  const num = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  const text = (value: unknown, fallback: string, max: number): string =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;

  const goals = (r.goals ?? {}) as Record<string, unknown>;
  const pomodoro = (r.pomodoro ?? {}) as Record<string, unknown>;
  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 12).map((t) => t.slice(0, 24))
    : [];
  const movementTypes = Array.isArray(r.movementTypes)
    ? (r.movementTypes.filter((t) => MOVEMENT_TYPES.includes(t as MovementType)) as MovementType[])
    : [];

  return {
    goals: {
      deepWorkMin: num(goals.deepWorkMin, base.goals.deepWorkMin, 15, 720),
      movementMin: num(goals.movementMin, base.goals.movementMin, 5, 480),
      tasks: num(goals.tasks, base.goals.tasks, 1, 20),
    },
    pomodoro: {
      focusMin: num(pomodoro.focusMin, base.pomodoro.focusMin, 1, 180),
      shortBreakMin: num(pomodoro.shortBreakMin, base.pomodoro.shortBreakMin, 1, 60),
      longBreakMin: num(pomodoro.longBreakMin, base.pomodoro.longBreakMin, 1, 90),
      roundsBeforeLong: num(pomodoro.roundsBeforeLong, base.pomodoro.roundsBeforeLong, 2, 12),
      autoStartBreaks: bool(pomodoro.autoStartBreaks, base.pomodoro.autoStartBreaks),
      autoStartFocus: bool(pomodoro.autoStartFocus, base.pomodoro.autoStartFocus),
      chimeSound: bool(pomodoro.chimeSound, base.pomodoro.chimeSound),
    },
    tags: tags.length ? tags : base.tags,
    movementTypes: movementTypes.length ? movementTypes : base.movementTypes,
    // v2 keeps these fixed; they are read by the streak rules, not the UI.
    weekStart: 1,
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    minimizeToTray: bool(r.minimizeToTray, base.minimizeToTray),
    startWithWindows: bool(r.startWithWindows, base.startWithWindows),
    notifications: bool(r.notifications, base.notifications),
    globalShortcut: text(r.globalShortcut, base.globalShortcut, 40),
    globalShortcutEnabled: bool(r.globalShortcutEnabled, base.globalShortcutEnabled),
    graceDay: true,
    lastTag: text(r.lastTag, base.lastTag, 40),
  };
}

function sanitizeDay(raw: unknown, key: string): DayRecord {
  const d = (raw ?? {}) as Partial<DayRecord>;
  return {
    date: key,
    note: typeof d.note === 'string' ? d.note : '',
    sessions: Array.isArray(d.sessions)
      ? d.sessions
          .filter((s) => s && typeof s === 'object')
          .map((s) => ({
            id: String(s.id ?? uid()),
            tag: String(s.tag ?? 'Untitled'),
            startedAt: String(s.startedAt ?? new Date().toISOString()),
            minutes: Math.max(1, Math.round(Number(s.minutes) || 0)),
            auto: Boolean(s.auto),
          }))
      : [],
    movements: Array.isArray(d.movements)
      ? d.movements
          .filter((m) => m && typeof m === 'object')
          .map((m) => ({
            id: String(m.id ?? uid()),
            type: (m.type ?? 'custom') as MovementType,
            label: m.label ? String(m.label) : undefined,
            minutes: Math.max(1, Math.round(Number(m.minutes) || 0)),
            intensity: Math.min(5, Math.max(1, Math.round(Number(m.intensity) || 3))),
            at: String(m.at ?? new Date().toISOString()),
          }))
      : [],
    tasks: Array.isArray(d.tasks)
      ? d.tasks
          .filter((t) => t && typeof t === 'object')
          .map((t, i) => ({
            id: String(t.id ?? uid()),
            title: String(t.title ?? '').slice(0, 200),
            priority: (['A', 'B', 'C'] as Priority[]).includes(t.priority as Priority) ? (t.priority as Priority) : 'B',
            done: Boolean(t.done),
            doneAt: t.doneAt ? String(t.doneAt) : undefined,
            createdAt: String(t.createdAt ?? new Date().toISOString()),
            order: Number.isFinite(Number(t.order)) ? Number(t.order) : i,
            carriedFrom: t.carriedFrom ? String(t.carriedFrom) : undefined,
          }))
          // Titles are required for the list to make sense; blank rows are noise.
          .filter((t) => t.title.trim().length > 0)
      : [],
  };
}

export function migrate(raw: unknown): DaybookData {
  let data = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>;
  let version = Number(data.version ?? 0);
  if (!Number.isFinite(version) || version < 0) version = 0;
  while (version < DATA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      version = DATA_VERSION;
      break;
    }
    data = step(data);
    version = Number(data.version ?? version + 1);
  }

  const base = defaultData(data.createdAt ? new Date(String(data.createdAt)) : new Date());
  const days: Record<string, DayRecord> = {};
  const rawDays = (data.days ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(rawDays)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    days[key] = sanitizeDay(rawDays[key], key);
  }

  const rawTimer = (data.timer ?? {}) as Partial<TimerState>;
  const timer: TimerState = {
    ...base.timer,
    ...rawTimer,
    mode:
      rawTimer.mode === 'short' || rawTimer.mode === 'long' || rawTimer.mode === 'custom' ? rawTimer.mode : 'focus',
    running: Boolean(rawTimer.running && rawTimer.endsAt),
    endsAt: typeof rawTimer.endsAt === 'number' ? rawTimer.endsAt : null,
    remainingMs: Math.max(0, Number(rawTimer.remainingMs) || base.timer.remainingMs),
    round: Math.max(0, Math.round(Number(rawTimer.round) || 0)),
    startedAt: typeof rawTimer.startedAt === 'number' ? rawTimer.startedAt : null,
    completed: Math.max(0, Math.round(Number(rawTimer.completed) || 0)),
    tag: typeof rawTimer.tag === 'string' && rawTimer.tag ? rawTimer.tag.slice(0, 24) : base.timer.tag,
    customMinutes: Math.min(
      600,
      Math.max(1, Math.round(Number(rawTimer.customMinutes) || DEFAULT_CUSTOM_MINUTES)),
    ),
  };

  const rawMeta = (data.meta ?? {}) as Partial<DaybookData['meta']>;
  const createdAt = typeof data.createdAt === 'string' ? data.createdAt : base.createdAt;
  const profile = sanitizeProfile(data.profile, createdAt);
  const rawNotes = (data.notes ?? {}) as Partial<NoteSheet>;
  const notes: NoteSheet = {
    html: typeof rawNotes.html === 'string' ? rawNotes.html.slice(0, NOTE_HTML_MAX) : '',
    updatedAt: typeof rawNotes.updatedAt === 'string' ? rawNotes.updatedAt : createdAt,
  };
  return {
    version: DATA_VERSION,
    createdAt,
    settings: mergeSettings(data.settings),
    notes,
    days,
    timer,
    meta: {
      launches: Math.max(0, Math.round(Number(rawMeta.launches) || 0)),
      lastOpenedAt: typeof rawMeta.lastOpenedAt === 'string' ? rawMeta.lastOpenedAt : base.meta.lastOpenedAt,
      seeded: Boolean(rawMeta.seeded),
      tasksStartAt: typeof rawMeta.tasksStartAt === 'string' ? rawMeta.tasksStartAt : null,
    },
    // Omitted entirely when there is no name: the Welcome screen keys off its
    // absence, so an empty profile must never be written back as a placeholder.
    ...(profile ? { profile } : {}),
    onboarding: sanitizeOnboarding(data.onboarding, Boolean(profile)),
  };
}

/* ------------------------------------------------------------------ *
 * Small utilities shared by both processes
 * ------------------------------------------------------------------ */

let uidCounter = 0;

/** Sortable, collision-proof enough for a single-user desktop app. */
export function uid(prefix = 'id'): string {
  uidCounter = (uidCounter + 1) % 100000;
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${uidCounter.toString(36)}${r}`;
}

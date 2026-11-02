import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, useDispatch, useStoreApi, useTimerSnapshot } from '../lib/store';
import { listIsFull, tasksCompletedOn, visibleTasks } from '../lib/tasks';
import { streakFor, totalsFor } from '../lib/stats';
import { formatMinutes, toKey, type DateKey } from '../lib/date';
import { count, longDay, noun } from '../lib/format';
import { GoalBar } from '../components/GoalBar';
import { AsciiMark, FEATHER_INK, SUN } from '../components/AsciiArt';
import { IconClose, IconPlus } from '../components/Icons';
import type { Notice } from '../components/Overlays';

const MOVEMENT_PRESETS = [10, 15, 20, 30, 45];


/**
 * Today, in three columns: Focus, Movement, Tasks. One primary action on the
 * screen (starting a focus session), one figure per column, and a task list
 * capped at seven open items so nothing ever needs scrolling.
 */
export function HomeView({
  onStartFocus,
  onOpenTimer,
  onNotice,
}: {
  onStartFocus: () => void;
  onOpenTimer: () => void;
  onNotice: (notice: Omit<Notice, 'id'>) => void;
}) {
  const data = useData();
  const today = toKey();
  const goals = data.settings.goals;
  // Who the day belongs to. Absent only if the file was hand-edited to remove
  // the name; the heading then reads exactly as it did before 1.2.0.
  const owner = data.profile?.name ?? '';
  const totals = totalsFor(data, today);
  const streak = useMemo(() => streakFor(data, 'combined', today), [data, today]);
  const todaySessions = data.days[today]?.sessions ?? [];
  const todayMovements = data.days[today]?.movements ?? [];

  const focusColumn = (
    <FocusColumn
      focusMin={totals.focusMin}
      goalMin={goals.deepWorkMin}
      sessions={todaySessions}
      onStartFocus={onStartFocus}
      onOpenTimer={onOpenTimer}
    />
  );
  const movementColumn = (
    <MovementColumn
      movementMin={totals.movementMin}
      goalMin={goals.movementMin}
      last={todayMovements[todayMovements.length - 1] ?? null}
    />
  );
  const tasksColumn = <TasksColumn today={today} goal={goals.tasks} onNotice={onNotice} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-8 py-3">
      <header className="flex shrink-0 items-end justify-between gap-6 border-b border-rule pb-2">
        <div>
          <div className="flex items-center gap-3">
            <span className="label">The daily edition</span>
            <span aria-hidden="true" className="block h-px w-7 bg-accent" />
          </div>
          <h1 className="mt-1 font-display text-page text-ink">Today{owner ? `, ${owner}` : ''}</h1>
          <p className="mt-0.5 font-text text-small text-ink-soft">{longDay(today)}</p>
        </div>
        <div className="relative flex items-stretch border border-rule bg-paper-raise">
          <div className="px-4 py-1.5 text-right">
            <p className="label">Streak</p>
            <p className="mt-0.5 font-display text-xl font-semibold leading-none text-ink tab">
              {streak.current}
              <span className="ml-1 font-text text-micro font-normal text-ink-soft">
                {noun(streak.current, 'day')}
              </span>
            </p>
          </div>
          <div className="border-l border-rule px-4 py-1.5 text-right">
            <p className="label">Today</p>
            <p className="mt-0.5 font-display text-xl font-semibold leading-none text-ink tab">{totals.score}%</p>
          </div>
          <div
            className="absolute inset-x-0 bottom-0 h-[2px] bg-rule"
            role="progressbar"
            aria-label="Today's progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={totals.score}
            aria-valuetext={`${totals.score}% of the day's goals`}
          >
            <div
              className="h-full bg-accent transition-[width] duration-500 ease-editorial"
              style={{ width: `${totals.score}%` }}
            />
          </div>
        </div>
      </header>

      {/* Three columns at every supported width. Collapsing to one column with a
          switcher below 1100px hid the task input — and the Home screen the brief
          asks for — at the 1000px minimum window. */}
      {/* The cards stretch to the window height, so the layout fills the screen at
          1080p instead of leaving the lower half empty. Each action lives at the
          bottom of its own card, not in a floating row far from its figure. */}
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-1 gap-6">
        {focusColumn}
        {movementColumn}
        {tasksColumn}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Focus
 * ------------------------------------------------------------------ */

function FocusColumn({
  focusMin,
  goalMin,
  sessions,
  onStartFocus,
  onOpenTimer,
}: {
  focusMin: number;
  goalMin: number;
  sessions: Array<{ id: string; tag: string; startedAt: string; minutes: number }>;
  onStartFocus: () => void;
  onOpenTimer: () => void;
}) {
  const snap = useTimerSnapshot();
  const running = snap?.timer.running ?? false;
  const recent = useMemo(
    () => [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 3),
    [sessions],
  );

  return (
    <section className="card" aria-labelledby="home-focus">
      <div className="card-head">
        <div className="flex items-baseline gap-2.5">
          <span aria-hidden="true" className="font-mono text-label tracking-[0.08em] text-ink-mute">01</span>
          <h2 id="home-focus" className="font-text text-small font-medium text-ink">
            Focus
          </h2>
        </div>
        {running ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="block h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="font-mono text-micro uppercase tracking-[0.12em] text-ink-mute">live</span>
          </span>
        ) : (
          <span aria-hidden="true" className="h-px w-6 bg-rule-strong" />
        )}
      </div>

      {/* The figure sits directly under its heading, where the eye expects it;
          the action anchors to the card's bottom edge. The figure grows with the
          window so a tall card is not a small number in a large void. */}
      <div className="card-body flex flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="metric-fluid font-display font-semibold leading-none text-ink tab">{formatMinutes(focusMin)}</p>
          <p className="mt-1 font-text text-small text-ink-soft">of {formatMinutes(goalMin)}</p>
          <GoalBar value={focusMin} goal={goalMin} label="Focus time against today's goal" />

          <div className="mt-4 hidden min-h-0 flex-col [@media(min-height:720px)]:flex">
            <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1">
              <span className="label">Today's sessions</span>
              <span className="meta">{count(sessions.length, 'session')}</span>
            </div>
            {recent.length ? (
              <ul className="mt-1.5 space-y-1">
                {recent.map((session) => (
                  <li key={session.id} className="flex items-baseline gap-2 font-text text-small">
                    <span className="font-mono text-micro text-ink-mute tab">
                      {new Date(session.startedAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{session.tag}</span>
                    <span className="font-mono text-micro text-ink-mute tab">{formatMinutes(session.minutes)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <AsciiMark art={SUN} className="text-[8px] text-ink-faint" />
                <p className="font-text text-small text-ink-mute">The page is still blank.</p>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4">
        {running ? (
          <button className="btn btn-primary w-full" onClick={onOpenTimer}>
            Open timer · <span className="tab">{clockOf(snap?.remainingMs ?? 0)}</span>
          </button>
        ) : (
          <button className="btn btn-primary w-full" onClick={onStartFocus}>
            Start focus
          </button>
        )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Movement
 * ------------------------------------------------------------------ */

function MovementColumn({
  movementMin,
  goalMin,
  last,
}: {
  movementMin: number;
  goalMin: number;
  last: { type: string; label?: string; minutes: number; at: string } | null;
}) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!popover.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const add = (minutes: number) => {
    const value = Math.min(1440, Math.max(1, Math.round(minutes)));
    dispatch({
      type: 'movement/add',
      date: toKey(),
      entry: { type: 'custom', minutes: value, intensity: 3, at: new Date().toISOString() },
    });
    setOpen(false);
    setCustom('');
  };

  return (
    <section className="card relative" aria-labelledby="home-movement">
      <div className="card-head">
        <div className="flex items-baseline gap-2.5">
          <span aria-hidden="true" className="font-mono text-label tracking-[0.08em] text-ink-mute">02</span>
          <h2 id="home-movement" className="font-text text-small font-medium text-ink">
            Movement
          </h2>
        </div>
        <span aria-hidden="true" className="h-px w-6 bg-rule-strong" />
      </div>

      <div className="card-body flex flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="metric-fluid font-display font-semibold leading-none text-ink tab">{movementMin} min</p>
          <p className="mt-1 font-text text-small text-ink-soft">of {goalMin} min</p>
          <GoalBar value={movementMin} goal={goalMin} label="Movement against today's goal" />

          <div className="mt-4 hidden [@media(min-height:720px)]:block">
            <p className="label">Last logged</p>
            {last ? (
              <p className="mt-1 font-text text-small text-ink-soft">
                <span className="font-mono text-micro text-ink-mute tab">{last.minutes} min</span>
                <span className="text-ink-mute"> · </span>
                {last.type === 'custom' ? last.label || 'Movement' : last.type[0].toUpperCase() + last.type.slice(1)}
                <span className="text-ink-mute"> · </span>
                <span className="font-mono text-micro text-ink-mute tab">
                  {new Date(last.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              </p>
            ) : (
              <p className="mt-1 font-text text-small text-ink-mute">Nothing logged yet.</p>
            )}
          </div>
        </div>

        <div className="pt-4">
        {open ? (
          <div ref={popover} className="border border-ink bg-paper p-3 shadow-offset-sm">
            <p className="meta">Minutes</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MOVEMENT_PRESETS.map((preset) => (
                <button key={preset} className="chip" onClick={() => add(preset)}>
                  {preset}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                className="numfield"
                type="number"
                min={1}
                max={1440}
                placeholder="other"
                aria-label="Custom minutes"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') add(Number(custom));
                }}
              />
              <button className="btn" onClick={() => add(Number(custom))} disabled={!custom.trim()}>
                Add
              </button>
            </div>
          </div>
        ) : (
          <button className="btn w-full" onClick={() => setOpen(true)}>
            <IconPlus size={15} /> Log movement
          </button>
        )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Tasks — the single rolling list
 * ------------------------------------------------------------------ */

function TasksColumn({ today, goal, onNotice }: { today: DateKey; goal: number; onNotice: (notice: Omit<Notice, 'id'>) => void }) {
  const data = useData();
  const store = useStoreApi();
  const { shown, waiting, total } = useMemo(() => visibleTasks(data), [data]);
  const full = listIsFull(data);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // Tasks finished today, wherever they were created (the list is rolling).
  const doneToday = useMemo(() => tasksCompletedOn(data, today), [data, today]);

  // Ctrl+N reaches this field through a window event (routed by the shell).
  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener('daybook:new-task', focus);
    return () => window.removeEventListener('daybook:new-task', focus);
  }, []);

  const addTask = () => {
    const title = draft.trim();
    if (!title || full) return;
    store.dispatch({ type: 'task/add', date: today, title });
    setDraft('');
  };

  const complete = (task: { id: string; date: string; title: string }) => {
    store.dispatch({ type: 'task/toggle', date: task.date, id: task.id });
    onNotice({
      tone: 'good',
      title: `Done: ${task.title}`,
      actionLabel: 'Undo',
      onAction: () => store.dispatch({ type: 'task/toggle', date: task.date, id: task.id }),
    });
  };

  return (
    <section className="card" aria-labelledby="home-tasks">
      <div className="card-head">
        <div className="flex items-baseline gap-2.5">
          <span aria-hidden="true" className="font-mono text-label tracking-[0.08em] text-ink-mute">03</span>
          <h2 id="home-tasks" className="font-text text-small font-medium text-ink">
            Tasks
          </h2>
        </div>
        <span className="meta">{count(total, 'task')} open</span>
      </div>

      <div className="card-body flex flex-col py-1.5">
      <div>
        <input
          ref={input}
          className="field"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addTask();
          }}
          placeholder={full ? 'List is full' : 'Add a task…'}
          aria-label="Add a task"
          disabled={full}
          maxLength={200}
        />
        {full ? <p className="mt-1 font-text text-micro text-ink-mute">List is full — finish or delete one.</p> : null}
      </div>

      <ul className="mt-1 flex min-h-0 flex-1 flex-col">
        {shown.map((task) => (
          <li key={task.id} className="entry group flex items-start gap-2 border-b border-rule py-[3px]">
            <button
              className="mt-[3px] h-[16px] w-[16px] shrink-0 border border-ink-soft bg-paper transition-colors hover:border-accent"
              aria-label={`Complete ${task.title}`}
              onClick={() => complete({ id: task.id, date: task.date, title: task.title })}
            />
            <span className="min-w-0 flex-1 font-text text-small text-ink">{task.title}</span>
            <button
              className="btn-text no-rule opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
              aria-label={`Delete ${task.title}`}
              onClick={() => store.dispatch({ type: 'task/remove', date: task.date, id: task.id })}
            >
              <IconClose size={14} />
            </button>
          </li>
        ))}
        {shown.length > 0 && shown.length < 4 ? (
          <li aria-hidden="true" className="mt-auto hidden justify-center pt-2 [@media(min-height:720px)]:flex">
            <AsciiMark art={FEATHER_INK} className="text-[8px] text-ink-faint/80" />
          </li>
        ) : null}

        {shown.length === 0 ? (
          <li className="flex flex-1 flex-col items-center justify-center gap-3 py-3">
            <AsciiMark art={FEATHER_INK} className="text-[10px] text-ink-faint" />
            <span className="font-text text-small text-ink-mute">Nothing open. Write the first line above.</span>
          </li>
        ) : null}
      </ul>

      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="font-text text-small text-ink-soft">
          <strong className="font-display text-xl font-semibold text-ink tab">{doneToday}</strong> of {goal} done today
        </p>
        {waiting > 0 ? <p className="font-text text-micro text-ink-mute">+{waiting} waiting</p> : null}
      </div>
      </div>
    </section>
  );
}

function clockOf(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

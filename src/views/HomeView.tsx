import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, useStoreApi } from '../lib/store';
import { listIsFull, tasksCompletedOn, visibleTasks } from '../lib/tasks';
import { streakFor, totalsFor } from '../lib/stats';
import { addDays, formatMinutes, startOfWeek, toKey, type DateKey } from '../lib/date';
import { count, noun } from '../lib/format';
import { GoalBar } from '../components/GoalBar';
import { NoteEditor } from '../components/NoteEditor';
import { AsciiMark, FEATHER_INK } from '../components/AsciiArt';
import { IconClose } from '../components/Icons';
import type { Notice } from '../components/Overlays';

/**
 * Today: the note sheet is the page, the task list is the margin, and focus
 * time is one quiet figure above it. There is no Start focus button here — the
 * timer tab owns starting work. This screen is where you write and plan.
 */
export function HomeView({ onNotice }: { onNotice: (notice: Omit<Notice, 'id'>) => void }) {
  const data = useData();
  const today = toKey();
  const totals = totalsFor(data, today);
  const goal = data.settings.goals.deepWorkMin;
  const streak = useMemo(() => streakFor(data, 'focus', today), [data, today]);

  const weekFocus = useMemo(() => {
    let sum = 0;
    const from = startOfWeek(today, 1);
    for (let key = from; key <= today; key = addDays(key, 1)) sum += totalsFor(data, key).focusMin;
    return sum;
  }, [data, today]);

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      <section
        className="card min-w-0 flex-1 flex-col p-0"
        aria-labelledby="home-notes"
      >
        <h2 id="home-notes" className="sr-only">
          Notes
        </h2>
        <NoteEditor />
      </section>

      <aside className="flex w-[clamp(16.25rem,26vw,19rem)] shrink-0 flex-col gap-3">
        <section className="card shrink-0 px-4 py-3" aria-labelledby="home-focus">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="home-focus" className="label">
                Focus today
              </h2>
              <p className="mt-1 font-display text-[2rem] font-semibold leading-none tracking-[-0.03em] text-ink tab">
                {formatMinutes(totals.focusMin)}
              </p>
            </div>
            <p className="mt-1 font-text text-small text-ink-mute tab">{formatMinutes(goal)}</p>
          </div>

          <div className="mt-3">
            <GoalBar value={totals.focusMin} goal={goal} label="Focus time against today's goal" compact />
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 font-text text-micro text-ink-soft">
            <span>{count(streak.current, 'day')} streak</span>
            <span>{formatMinutes(weekFocus)} this week</span>
          </div>
        </section>

        <TasksColumn today={today} goal={data.settings.goals.tasks} onNotice={onNotice} />
      </aside>
    </div>
  );
}

function TasksColumn({
  today,
  goal,
  onNotice,
}: {
  today: DateKey;
  goal: number;
  onNotice: (notice: Omit<Notice, 'id'>) => void;
}) {
  const data = useData();
  const store = useStoreApi();
  const { shown, waiting, total } = useMemo(() => visibleTasks(data), [data]);
  const full = listIsFull(data);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const doneToday = useMemo(() => tasksCompletedOn(data, today), [data, today]);

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
    <section className="card min-h-0 flex-1" aria-labelledby="home-tasks">
      <div className="card-head">
        <h2 id="home-tasks" className="font-text text-small font-semibold text-ink">
          Tasks
        </h2>
        <span className="font-text text-micro text-ink-mute tab">{noun(total, 'task')}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-2.5">
        <input
          ref={input}
          className="field"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addTask();
          }}
          placeholder={full ? 'List is full' : 'Add a task'}
          aria-label="Add a task"
          disabled={full}
          maxLength={200}
        />

        <ul className="mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden">
          {shown.map((task) => (
            <li key={task.id} className="entry group flex items-start gap-2.5 rounded-[7px] px-1 py-[5px]">
              <button
                className="mt-[3px] h-[15px] w-[15px] shrink-0 rounded-[4px] border border-rule-strong bg-paper transition-colors hover:border-accent hover:bg-accent-wash"
                aria-label={`Complete ${task.title}`}
                onClick={() => complete({ id: task.id, date: task.date, title: task.title })}
              />
              <span className="min-w-0 flex-1 font-text text-small leading-snug text-ink">{task.title}</span>
              <button
                className="btn-text no-rule -my-1 shrink-0 px-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                aria-label={`Delete ${task.title}`}
                onClick={() => store.dispatch({ type: 'task/remove', date: task.date, id: task.id })}
              >
                <IconClose size={13} />
              </button>
            </li>
          ))}

          {shown.length === 0 ? (
            <li className="flex flex-1 flex-col items-center justify-center gap-2 py-4">
              <AsciiMark art={FEATHER_INK} className="text-[8px] text-ink-faint" />
              <span className="font-text text-small text-ink-mute">No open tasks</span>
            </li>
          ) : null}
        </ul>

        <div className="mt-1 flex shrink-0 items-center justify-between gap-3 border-t border-rule pt-2">
          <p className="font-text text-micro text-ink-soft">
            <strong className="font-text text-small font-semibold text-ink tab">{doneToday}</strong> of {goal} done
          </p>
          {waiting > 0 ? <p className="font-text text-micro text-ink-mute">+{waiting} waiting</p> : null}
        </div>
      </div>
    </section>
  );
}

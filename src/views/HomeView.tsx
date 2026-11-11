import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, useStoreApi } from '../lib/store';
import { MAX_OPEN_TASKS, taskBuckets, tasksCompletedOn, type OpenTask } from '../lib/tasks';
import { streakFor, totalsFor } from '../lib/stats';
import { addDays, diffDays, formatMinutes, startOfWeek, toKey, type DateKey } from '../lib/date';
import { count, noun } from '../lib/format';
import { uid, type Note } from '../lib/schema';
import { GoalBar } from '../components/GoalBar';
import { NoteEditor } from '../components/NoteEditor';
import { IconClose, IconPlus } from '../components/Icons';
import type { Notice } from '../components/Overlays';

/**
 * Today: the note library is the page, the daily task list is the margin, and
 * focus time is one quiet figure above it. Notes are cards when there is more
 * than one; opening a card gives it the full page. There is no Start focus
 * button here — the timer tab owns starting work.
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
      <section className="card min-w-0 flex-1 p-0" aria-label="Notes">
        <NotesPanel />
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

function NotesPanel() {
  const data = useData();
  const store = useStoreApi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const selected = data.notes.find((note) => note.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !data.notes.some((note) => note.id === selectedId)) setSelectedId(null);
  }, [data.notes, selectedId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.notes;
    return data.notes.filter((note) => `${note.title} ${plainText(note.html)}`.toLowerCase().includes(needle));
  }, [data.notes, query]);

  const createNote = () => {
    const id = uid('note');
    store.dispatch({ type: 'note/add', id, title: 'Untitled note', html: '' });
    setSelectedId(id);
    setQuery('');
  };

  if (selected) {
    return (
      <NoteEditor
        key={selected.id}
        note={selected}
        onBack={() => setSelectedId(null)}
        onSave={(patch) => store.dispatch({ type: 'note/update', id: selected.id, patch })}
        onDelete={() => {
          store.dispatch({ type: 'note/remove', id: selected.id });
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
        <h2 className="font-text text-small font-semibold text-ink">Notes</h2>
        <span className="font-text text-micro text-ink-mute tab">{count(data.notes.length, 'note')}</span>
        <label className="ml-auto min-w-[8.5rem] flex-1 sm:max-w-[14rem]">
          <span className="sr-only">Search notes</span>
          <input
            className="field h-8 min-h-0 py-1"
            type="search"
            value={query}
            aria-label="Search notes"
            placeholder="Search notes"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" className="btn btn-primary h-8 min-h-0 shrink-0 px-3" onClick={createNote}>
          <IconPlus size={14} /> New note
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {data.notes.length === 0 ? (
          <EmptyNotes onCreate={createNote} />
        ) : filtered.length === 0 ? (
          <div className="flex h-full min-h-[12rem] flex-col items-center justify-center text-center">
            <p className="font-text text-small text-ink-soft">No notes match “{query.trim()}”.</p>
            <button type="button" className="btn-text mt-2" onClick={() => setQuery('')}>
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filtered.map((note) => (
              <NoteCard key={note.id} note={note} onOpen={() => setSelectedId(note.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyNotes({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-[1.4rem] font-semibold tracking-[-0.03em] text-ink">A blank page, whenever you need it.</p>
      <p className="mt-1 max-w-[26rem] font-text text-small text-ink-soft">
        Give a note a title and it will sit here as a card, ready to open again.
      </p>
      <button type="button" className="btn btn-primary mt-4" onClick={onCreate}>
        <IconPlus size={15} /> Write the first note
      </button>
    </div>
  );
}

function NoteCard({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const preview = plainText(note.html).slice(0, 170);
  return (
    <button
      type="button"
      data-note-card={note.id}
      onClick={onOpen}
      className="group flex min-h-[9.5rem] flex-col rounded-[10px] border border-rule bg-paper p-4 text-left transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-rule-strong hover:shadow-soft focus-visible:border-accent"
    >
      <span className="line-clamp-2 font-display text-[1.08rem] font-semibold leading-snug tracking-[-0.02em] text-ink">{note.title}</span>
      <span className="mt-2 line-clamp-3 flex-1 font-text text-small leading-snug text-ink-soft">
        {preview || 'Empty note'}
      </span>
      <span className="mt-3 flex items-center justify-between gap-2 font-text text-micro text-ink-mute">
        <span>{noteWhen(note.updatedAt)}</span>
        <span>{wordCount(note.html)} words</span>
      </span>
    </button>
  );
}

function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(html: string): number {
  const text = plainText(html);
  return text ? text.split(' ').filter(Boolean).length : 0;
}

function noteWhen(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Unsaved';
  const key = toKey(date);
  if (key === toKey()) return `Today, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  if (key === toKey(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
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
  const { today: todayTasks, carried, total } = useMemo(() => taskBuckets(data, today), [data, today]);
  const full = total >= MAX_OPEN_TASKS;
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

  const complete = (task: OpenTask) => {
    store.dispatch({ type: 'task/toggle', date: task.date, id: task.id });
    onNotice({
      tone: 'good',
      title: `Done: ${task.title}`,
      actionLabel: 'Undo',
      onAction: () => store.dispatch({ type: 'task/toggle', date: task.date, id: task.id }),
    });
  };

  const remove = (task: OpenTask) => store.dispatch({ type: 'task/remove', date: task.date, id: task.id });

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

        <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto pr-0.5">
          {total === 0 ? (
            <div className="flex h-full min-h-[7rem] items-center justify-center px-3 text-center">
              <p className="font-text text-small text-ink-mute">Nothing open. Add one thing for today.</p>
            </div>
          ) : (
            <>
              {carried.length > 0 ? (
                <div data-task-group="carried">
                  <p className="px-1 pb-1 pt-1 font-text text-micro font-medium text-accent-deep">
                    Remaining from earlier
                  </p>
                  <ul>
                    {carried.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        today={today}
                        onComplete={() => complete(task)}
                        onRemove={() => remove(task)}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}

              {todayTasks.length > 0 ? (
                <div data-task-group="today">
                  {carried.length > 0 ? <p className="px-1 pb-1 pt-2 font-text text-micro font-medium text-ink-mute">Today</p> : null}
                  <ul>
                    {todayTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        today={today}
                        onComplete={() => complete(task)}
                        onRemove={() => remove(task)}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-1 flex shrink-0 items-center justify-between gap-3 border-t border-rule pt-2">
          <p className="font-text text-micro text-ink-soft">
            <strong className="font-text text-small font-semibold text-ink tab">{doneToday}</strong> of {goal} done
          </p>
          {carried.length > 0 ? (
            <p className="font-text text-micro text-accent-deep">{noun(carried.length, 'task')} carried</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TaskRow({
  task,
  today,
  onComplete,
  onRemove,
}: {
  task: OpenTask;
  today: DateKey;
  onComplete: () => void;
  onRemove: () => void;
}) {
  const age = diffDays(today, task.origin);
  return (
    <li
      data-task-origin={task.origin}
      className="entry group flex items-start gap-2.5 rounded-[7px] px-1 py-[5px]"
    >
      <button
        className="mt-[3px] h-[15px] w-[15px] shrink-0 rounded-[4px] border border-rule-strong bg-paper transition-colors hover:border-accent hover:bg-accent-wash"
        aria-label={`Complete ${task.title}`}
        onClick={onComplete}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-text text-small leading-snug text-ink">{task.title}</span>
        {age > 0 ? (
          <span className="mt-0.5 block font-text text-micro text-ink-mute">
            {age === 1 ? 'From yesterday' : `${age} days old`}
          </span>
        ) : null}
      </span>
      <button
        className="btn-text no-rule -my-1 shrink-0 px-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        aria-label={`Delete ${task.title}`}
        onClick={onRemove}
      >
        <IconClose size={13} />
      </button>
    </li>
  );
}

import { useState } from 'react';
import { useDispatch, useSelect } from '../lib/store';
import type { Task } from '../lib/schema';
import { formatMinutes, fromKey, type DateKey } from '../lib/date';
import { count } from '../lib/format';
import { IconPlus, IconTrash } from './Icons';
import { Sheet } from './Overlays';

const VISIBLE_ROWS = 5;

/**
 * The day dialog: one day's focus sessions and completed tasks, editable in
 * place. It is the one panel allowed to scroll internally. Movement was
 * retired from the interface in 2.0.0; older entries stay in the JSON file.
 */
export function DayDialog({ date, onClose }: { date: DateKey | null; onClose: () => void }) {
  const dispatch = useDispatch();
  const day = useSelect((data) => (date ? data.days[date] : undefined));
  const lastTag = useSelect((data) => data.settings.lastTag);
  const goals = useSelect((data) => data.settings.goals);
  const [expanded, setExpanded] = useState<{ sessions: boolean; tasks: boolean }>({
    sessions: false,
    tasks: false,
  });

  if (!date) return null;

  const sessions = day?.sessions ?? [];
  const completed = (day?.tasks ?? []).filter((task) => task.done);
  const focusMin = sessions.reduce((a, s) => a + s.minutes, 0);
  const heading = fromKey(date).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const stamp = fromKey(date);
  const atHour = (hour: number) => {
    const d = new Date(stamp);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const rowsFor = <T,>(list: T[], key: 'sessions' | 'tasks') =>
    expanded[key] ? list : list.slice(0, VISIBLE_ROWS);

  return (
    <Sheet open onClose={onClose} title={heading} width="40rem" scroll>
      <p className="font-text text-small text-ink-soft tab">
        {formatMinutes(focusMin)} focus · {count(completed.length, 'task')} done
        {focusMin >= goals.deepWorkMin ? ' · goal met' : ''}
      </p>

      <section className="mt-4" aria-label="Focus sessions">
        <header className="flex items-center justify-between border-b border-rule pb-1.5">
          <h3 className="font-text text-small font-semibold text-ink">Focus sessions</h3>
          <button
            className="btn-text"
            onClick={() =>
              dispatch({ type: 'session/add', date, session: { tag: lastTag, startedAt: atHour(9), minutes: 25, auto: false } })
            }
          >
            <IconPlus size={14} /> Add session
          </button>
        </header>

        {sessions.length === 0 ? (
          <p className="mt-2 font-text text-small text-ink-mute">No sessions.</p>
        ) : (
          <ul className="mt-1.5">
            {rowsFor(sessions, 'sessions').map((session) => (
              <li key={session.id} className="entry flex items-center gap-2 rounded-[6px] px-1 py-1.5">
                <span className="w-[3.5rem] shrink-0 font-mono text-micro text-ink-mute tab">
                  {new Date(session.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
                <input
                  className="field min-w-0 flex-1"
                  defaultValue={session.tag}
                  aria-label="Session tag"
                  onBlur={(event) => {
                    const tag = event.target.value.trim().slice(0, 24) || 'No tag';
                    if (tag !== session.tag) dispatch({ type: 'session/update', date, id: session.id, patch: { tag } });
                    event.target.value = tag;
                  }}
                />
                <input
                  className="numfield"
                  type="number"
                  min={1}
                  max={1440}
                  defaultValue={session.minutes}
                  aria-label="Session minutes"
                  onBlur={(event) => {
                    const minutes = clamp(Number(event.target.value), 1, 1440, session.minutes);
                    event.target.value = String(minutes);
                    if (minutes !== session.minutes) dispatch({ type: 'session/update', date, id: session.id, patch: { minutes } });
                  }}
                />
                <span className="font-text text-micro text-ink-mute">min</span>
                <button
                  className="btn-text no-rule"
                  aria-label={`Delete session ${session.tag}`}
                  onClick={() => dispatch({ type: 'session/remove', date, id: session.id })}
                >
                  <IconTrash size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <MoreRow
          hidden={sessions.length - VISIBLE_ROWS}
          expanded={expanded.sessions}
          onClick={() => setExpanded((e) => ({ ...e, sessions: !e.sessions }))}
        />
      </section>

      <section className="mt-5" aria-label="Tasks completed">
        <header className="border-b border-rule pb-1.5">
          <h3 className="font-text text-small font-semibold text-ink">Tasks done</h3>
        </header>
        {completed.length === 0 ? (
          <p className="mt-2 font-text text-small text-ink-mute">No tasks.</p>
        ) : (
          <ul className="mt-1.5">
            {rowsFor(completed, 'tasks').map((task: Task) => (
              <li key={task.id} className="entry flex items-center gap-2 rounded-[6px] px-1 py-1.5">
                <input
                  className="field min-w-0 flex-1"
                  defaultValue={task.title}
                  aria-label="Task title"
                  onBlur={(event) => {
                    const title = event.target.value.trim();
                    if (title && title !== task.title) dispatch({ type: 'task/update', date, id: task.id, patch: { title } });
                    else event.target.value = task.title;
                  }}
                />
                <button
                  className="btn-text no-rule"
                  aria-label={`Delete task ${task.title}`}
                  onClick={() => dispatch({ type: 'task/remove', date, id: task.id })}
                >
                  <IconTrash size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <MoreRow
          hidden={completed.length - VISIBLE_ROWS}
          expanded={expanded.tasks}
          onClick={() => setExpanded((e) => ({ ...e, tasks: !e.tasks }))}
        />
      </section>
    </Sheet>
  );
}

function MoreRow({ hidden, expanded, onClick }: { hidden: number; expanded: boolean; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button className="btn-text mt-1" onClick={onClick}>
      {expanded ? 'Show fewer' : `+${hidden} more`}
    </button>
  );
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

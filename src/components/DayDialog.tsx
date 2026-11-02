import { useState } from 'react';
import { useDispatch, useSelect } from '../lib/store';
import { MOVEMENT_TYPES, type MovementType, type Task } from '../lib/schema';
import { formatMinutes, fromKey, type DateKey } from '../lib/date';
import { count } from '../lib/format';
import { IconPlus, IconTrash } from './Icons';
import { Sheet } from './Overlays';

const VISIBLE_ROWS = 5;

/**
 * The day dialog: one day's figures, each row editable in place. It is the one
 * panel allowed to scroll internally, and the only place a past day is edited —
 * everything else in Activity is read-only. Every change recomputes the
 * heatmap, the charts and the figures behind this dialog immediately, because
 * they are all derived from the same stored days.
 */
export function DayDialog({ date, onClose }: { date: DateKey | null; onClose: () => void }) {
  const dispatch = useDispatch();
  const day = useSelect((data) => (date ? data.days[date] : undefined));
  const lastTag = useSelect((data) => data.settings.lastTag);
  const goals = useSelect((data) => data.settings.goals);
  const [expanded, setExpanded] = useState<{ sessions: boolean; movement: boolean; tasks: boolean }>({
    sessions: false,
    movement: false,
    tasks: false,
  });

  if (!date) return null;

  const sessions = day?.sessions ?? [];
  const movements = day?.movements ?? [];
  const completed = (day?.tasks ?? []).filter((task) => task.done);
  const focusMin = sessions.reduce((a, s) => a + s.minutes, 0);
  const movementMin = movements.reduce((a, m) => a + m.minutes, 0);
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

  const rowsFor = <T,>(list: T[], key: 'sessions' | 'movement' | 'tasks') =>
    expanded[key] ? list : list.slice(0, VISIBLE_ROWS);

  return (
    <Sheet open onClose={onClose} title={heading} width="42rem" scroll>
      <p className="font-text text-small text-ink-soft tab">
        {formatMinutes(focusMin)} focus · {movementMin} min movement · {count(completed.length, 'task')} done
        {focusMin >= goals.deepWorkMin ? ' · focus goal met' : ''}
      </p>

      {/* ---------------------------------------------------------- focus */}
      <section className="mt-4" aria-label="Focus sessions">
        <header className="flex items-center justify-between border-b border-ink pb-1">
          <h3 className="font-text text-small font-medium text-ink">Focus sessions</h3>
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
          <p className="mt-2 font-text text-small text-ink-mute">Nothing logged.</p>
        ) : (
          <ul className="mt-1">
            {rowsFor(sessions, 'sessions').map((session) => (
              <li key={session.id} className="entry flex items-center gap-2 border-b border-rule py-1.5">
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

      {/* ------------------------------------------------------- movement */}
      <section className="mt-5" aria-label="Movement">
        <header className="flex items-center justify-between border-b border-ink pb-1">
          <h3 className="font-text text-small font-medium text-ink">Movement</h3>
          <button
            className="btn-text"
            onClick={() =>
              dispatch({ type: 'movement/add', date, entry: { type: 'walk', minutes: 30, intensity: 3, at: atHour(18) } })
            }
          >
            <IconPlus size={14} /> Add movement
          </button>
        </header>

        {movements.length === 0 ? (
          <p className="mt-2 font-text text-small text-ink-mute">Nothing logged.</p>
        ) : (
          <ul className="mt-1">
            {rowsFor(movements, 'movement').map((entry) => (
              <li key={entry.id} className="entry flex items-center gap-2 border-b border-rule py-1.5">
                <select
                  className="field w-[8rem] shrink-0"
                  defaultValue={entry.type}
                  aria-label="Activity type"
                  onChange={(event) =>
                    dispatch({ type: 'movement/update', date, id: entry.id, patch: { type: event.target.value as MovementType } })
                  }
                >
                  {MOVEMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  className="numfield"
                  type="number"
                  min={1}
                  max={1440}
                  defaultValue={entry.minutes}
                  aria-label="Movement minutes"
                  onBlur={(event) => {
                    const minutes = clamp(Number(event.target.value), 1, 1440, entry.minutes);
                    event.target.value = String(minutes);
                    if (minutes !== entry.minutes) dispatch({ type: 'movement/update', date, id: entry.id, patch: { minutes } });
                  }}
                />
                <span className="font-text text-micro text-ink-mute">min</span>
                <span className="ml-auto font-mono text-micro text-ink-mute">effort {entry.intensity}/5</span>
                <button
                  className="btn-text no-rule"
                  aria-label={`Delete ${entry.type}`}
                  onClick={() => dispatch({ type: 'movement/remove', date, id: entry.id })}
                >
                  <IconTrash size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <MoreRow
          hidden={movements.length - VISIBLE_ROWS}
          expanded={expanded.movement}
          onClick={() => setExpanded((e) => ({ ...e, movement: !e.movement }))}
        />
      </section>

      {/* ---------------------------------------------------------- tasks */}
      <section className="mt-5" aria-label="Tasks completed">
        <header className="border-b border-ink pb-1">
          <h3 className="font-text text-small font-medium text-ink">Tasks done</h3>
        </header>
        {completed.length === 0 ? (
          <p className="mt-2 font-text text-small text-ink-mute">Nothing finished.</p>
        ) : (
          <ul className="mt-1">
            {rowsFor(completed, 'tasks').map((task: Task) => (
              <li key={task.id} className="entry flex items-center gap-2 border-b border-rule py-1.5">
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
                  onClick={() => {
                    dispatch({ type: 'task/remove', date, id: task.id });
                  }}
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

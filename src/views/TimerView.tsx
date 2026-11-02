import { useMemo, useState } from 'react';
import { useData, useDispatch, useStoreApi } from '../lib/store';
import { usePomodoro } from '../hooks/usePomodoro';
import { formatMinutes, toKey } from '../lib/date';
import { count } from '../lib/format';
import { totalsFor } from '../lib/stats';
import { Segmented } from '../components/Segmented';
import { TimerRing } from '../components/TimerRing';
import { Odometer } from '../components/Odometer';
import { IconClose, IconExitFullscreen, IconFullscreen, IconPlus } from '../components/Icons';
import { Sheet } from '../components/Overlays';
import { useElementSize } from '../hooks/useElementSize';

type ModeSwitch = 'pomodoro' | 'custom';

const CUSTOM_PRESETS = [15, 30, 45, 60, 90];

/**
 * The timer room. Two modes, one instrument: a thin ring, oversized digits and
 * a single primary action. Pomodoro uses the lengths from Settings and counts
 * rounds; Custom is whatever length you set, remembered for next time. Both
 * log finished work to today's focus time under the chosen tag.
 */
export function TimerView({
  fullscreen,
  onToggleFullscreen,
  onEditLengths,
}: {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onEditLengths: () => void;
}) {
  const timer = usePomodoro();
  const data = useData();
  const [confirmReset, setConfirmReset] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const { ref, size } = useElementSize<HTMLDivElement>({ w: 900, h: 420 });

  const mode: ModeSwitch = timer.mode === 'custom' ? 'custom' : 'pomodoro';
  const busy = timer.running;

  const ringSize = Math.max(190, Math.min(330, size.h - (fullscreen ? 120 : 205)));
  const today = totalsFor(data, toKey());

  const switchMode = (next: ModeSwitch) => {
    if (busy) return;
    setConfirmReset(false);
    timer.setMode(next === 'custom' ? 'custom' : 'focus');
  };

  const rounds = timer.roundsBeforeLong;
  const roundsDone = timer.round % Math.max(1, rounds);

  return (
    <div ref={ref} className="relative flex h-full min-h-0 flex-col items-center px-8 py-4">
      <div className="absolute right-6 top-3">
        <button
          className="btn-text no-rule"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'}
          title={fullscreen ? 'Leave fullscreen (Esc)' : 'Fullscreen (F11)'}
        >
          {fullscreen ? <IconExitFullscreen size={16} /> : <IconFullscreen size={16} />}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
        {fullscreen ? null : (
          <Segmented
            label="Timer mode"
            value={mode}
            onChange={switchMode}
            disabled={busy}
            disabledReason="Finish or reset the timer first"
            options={[
              { id: 'pomodoro', label: 'Pomodoro' },
              { id: 'custom', label: 'Custom' },
            ]}
          />
        )}

        <TimerRing progress={timer.progress} size={ringSize} label={`${timer.label}: ${timer.clock} remaining`}>
          {mode === 'custom' && !timer.running && !timer.hasSpentTime ? (
            <CustomClock
              minutes={timer.customMinutes}
              onChange={(minutes) => timer.setCustomMinutes(minutes)}
            />
          ) : (
            <p className="font-mono text-clock font-medium leading-none text-ink tab">
              <Odometer value={timer.clock} />
            </p>
          )}
          <p className="mt-1 font-text text-small text-ink-soft">
            {mode === 'custom' ? 'Custom' : timer.label}
          </p>
        </TimerRing>

        {mode === 'pomodoro' ? (
          <div className="flex flex-col items-center gap-1.5">
            <p className="font-text text-small text-ink-soft">
              Round {Math.max(1, Math.min(rounds, roundsDone + (timer.running && timer.mode === 'focus' ? 1 : 0)))} of {rounds}
            </p>
            <div className="flex items-center gap-1.5" aria-hidden>
              {Array.from({ length: rounds }, (_, i) => (
                <span
                  key={i}
                  className={`h-2 w-2 rounded-full border border-ink-mute ${i < roundsDone ? 'border-accent bg-accent' : 'bg-transparent'}`}
                />
              ))}
            </div>
            {fullscreen ? null : (
              <button className="btn-text" onClick={onEditLengths}>
                {timer.focusMin} · {timer.shortMin} · {timer.longMin} — Edit
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {CUSTOM_PRESETS.map((preset) => (
              <button
                key={preset}
                className={`chip ${timer.customMinutes === preset ? 'chip-on' : ''}`}
                onClick={() => timer.setCustomMinutes(preset)}
                disabled={busy}
              >
                {preset} min
              </button>
            ))}
          </div>
        )}

        {confirmReset ? (
          <div className="flex items-center gap-3 border border-accent bg-paper px-3 py-2 shadow-offset-sm" role="alert">
            <span className="font-text text-small text-ink">Discard {timer.clock}?</span>
            <button
              className="btn"
              onClick={() => {
                timer.reset();
                setConfirmReset(false);
              }}
            >
              Discard
            </button>
            <button className="btn-text" onClick={() => setConfirmReset(false)}>
              Keep going
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {fullscreen ? null : (
              <button
                className="btn"
                onClick={() => {
                  // Reset discards; once a minute is spent, ask before throwing it away.
                  if (timer.hasSpentTime) setConfirmReset(true);
                  else timer.reset();
                }}
              >
                Reset
              </button>
            )}
            <button className="btn btn-primary min-w-[8.5rem]" onClick={timer.toggle}>
              {timer.running ? 'Pause' : 'Start'}
            </button>
            {fullscreen ? null : mode === 'custom' ? (
              timer.hasSpentTime ? (
                <button className="btn" onClick={timer.stop} title="Log the time spent and stop">
                  Stop &amp; log
                </button>
              ) : null
            ) : (
              <button className="btn" onClick={timer.skip} title="End this session and move on">
                Skip
              </button>
            )}
          </div>
        )}

        {fullscreen ? null : (
          <div className="flex max-w-[46rem] flex-wrap items-center justify-center gap-1.5">
            <span className="mr-1 font-text text-small text-ink-soft">Working on:</span>
            <TagChips />
          </div>
        )}
      </div>

      {fullscreen ? null : (
        <footer className="flex w-full shrink-0 items-center justify-center gap-4 border-t border-rule pt-2">
          <p className="font-text text-small text-ink-soft">
            Today {formatMinutes(today.focusMin)} · {count(today.sessions, 'session')}
          </p>
          <button className="btn-text" onClick={() => setManualOpen(true)}>
            Add a session manually
          </button>
        </footer>
      )}

      <ManualSession open={manualOpen} onClose={() => setManualOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Custom length field — the HH:MM inside the ring
 * ------------------------------------------------------------------ */

function CustomClock({ minutes, onChange }: { minutes: number; onChange: (next: number) => void }) {
  const [draft, setDraft] = useState(formatClockInput(minutes));
  const [editing, setEditing] = useState(false);
  const value = editing ? draft : formatClockInput(minutes);

  const commit = () => {
    const parsed = parseClock(draft);
    setEditing(false);
    if (parsed === null) {
      setDraft(formatClockInput(minutes));
      return;
    }
    onChange(parsed);
  };

  return (
    <div className="flex flex-col items-center">
      <input
        className="w-[6.5ch] border-0 bg-transparent text-center font-mono text-clock font-medium leading-none text-ink tab outline-none focus-visible:outline-none"
        value={value}
        aria-label="Timer length, hours and minutes"
        inputMode="numeric"
        onFocus={() => {
          setEditing(true);
          setDraft(formatClockInput(minutes));
        }}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setDraft(formatClockInput(minutes));
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
      />
      <span className="mt-1 font-text text-micro text-ink-mute">HH:MM — click to edit</span>
    </div>
  );
}

/** 45 → "00:45", 90 → "01:30". */
function formatClockInput(minutes: number): string {
  const m = Math.min(600, Math.max(1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Accepts "45" (minutes), "1:30" and "01:30". Returns minutes, or null. */
function parseClock(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  if (/^\d{1,3}$/.test(text)) {
    const minutes = Number(text);
    return minutes >= 1 && minutes <= 600 ? minutes : null;
  }
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (mins > 59) return null;
  const total = hours * 60 + mins;
  return total >= 1 && total <= 600 ? total : null;
}

/* ------------------------------------------------------------------ *
 * Tag chips
 * ------------------------------------------------------------------ */

function TagChips() {
  const data = useData();
  const store = useStoreApi();
  const timer = usePomodoro();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const add = () => {
    const tag = draft.trim().slice(0, 24);
    if (!tag) return;
    if (!data.settings.tags.includes(tag)) store.dispatch({ type: 'settings/addTag', tag });
    timer.setTag(tag);
    setDraft('');
    setAdding(false);
  };

  return (
    <>
      {data.settings.tags.map((tag) => {
        const active = tag === timer.tag;
        return (
          <span key={tag} className={`group chip ${active ? 'chip-on' : ''} pr-1`}>
            <button onClick={() => timer.setTag(tag)} aria-pressed={active} className="font-text">
              {tag}
            </button>
            <button
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Delete tag ${tag}`}
              onClick={() => store.dispatch({ type: 'settings/removeTag', tag })}
            >
              <IconClose size={12} />
            </button>
          </span>
        );
      })}

      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            className="field w-[8rem] py-1"
            value={draft}
            autoFocus
            aria-label="New tag"
            maxLength={24}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
              if (event.key === 'Escape') setAdding(false);
            }}
            onBlur={add}
          />
        </span>
      ) : (
        <button className="chip" onClick={() => setAdding(true)} aria-label="Add a tag">
          <IconPlus size={13} />
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Manual session
 * ------------------------------------------------------------------ */

function ManualSession({ open, onClose }: { open: boolean; onClose: () => void }) {
  const data = useData();
  const dispatch = useDispatch();
  const [minutes, setMinutes] = useState('25');
  const [tag, setTag] = useState(data.settings.lastTag);
  const [time, setTime] = useState('09:00');

  const save = () => {
    const value = Math.min(1440, Math.max(1, Math.round(Number(minutes) || 25)));
    const [h, m] = time.split(':').map(Number);
    const started = new Date();
    started.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
    dispatch({ type: 'session/add', date: toKey(), session: { tag: tag || 'No tag', startedAt: started.toISOString(), minutes: value, auto: false } });
    onClose();
  };

  const tagOptions = useMemo(() => {
    const set = new Set([...data.settings.tags, tag].filter(Boolean));
    return [...set];
  }, [data.settings.tags, tag]);

  return (
    <Sheet open={open} onClose={onClose} title="Add a session" width="26rem">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="meta">Minutes</span>
          <input
            className="numfield mt-1 w-full"
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="meta">Started at</span>
          <input className="numfield mt-1 w-full" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="meta">Tag</span>
        <select className="field mt-1" value={tag} onChange={(event) => setTag(event.target.value)}>
          {tagOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save}>
          Add session
        </button>
      </div>
    </Sheet>
  );
}

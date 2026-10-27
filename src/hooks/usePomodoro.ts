import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSelect, useStoreApi, useTimerSnapshot } from '../lib/store';
import type { TimerCommand } from '../lib/ipc';
import type { TimerMode } from '../lib/schema';

export interface PomodoroView {
  mode: TimerMode;
  running: boolean;
  remainingMs: number;
  totalMs: number;
  progress: number;
  label: string;
  clock: string;
  round: number;
  roundsBeforeLong: number;
  tag: string;
  completed: number;
  customMinutes: number;
  /** Configured lengths, for the "25 · 5 · 15 — Edit" line. */
  focusMin: number;
  shortMin: number;
  longMin: number;
  /** True when at least a minute of this run has been spent (Reset warns). */
  hasSpentTime: boolean;
  send: (cmd: TimerCommand) => void;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  skip: () => void;
  stop: () => void;
  setMode: (mode: TimerMode) => void;
  setTag: (tag: string) => void;
  setCustomMinutes: (minutes: number) => void;
}

const LABELS: Record<TimerMode, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
  custom: 'Custom',
};

export function usePomodoro(): PomodoroView {
  const store = useStoreApi();
  const snap = useTimerSnapshot();
  const roundsBeforeLong = useSelect((d) => d.settings.pomodoro.roundsBeforeLong);
  const focusMin = useSelect((d) => d.settings.pomodoro.focusMin);
  const shortMin = useSelect((d) => d.settings.pomodoro.shortBreakMin);
  const longMin = useSelect((d) => d.settings.pomodoro.longBreakMin);

  const send = useCallback(
    (cmd: TimerCommand) => {
      void store.bridge.timer.send(cmd);
    },
    [store],
  );

  // Keep the browser-preview tab title in step (Electron sets the real window
  // title from the main process).
  const lastTitle = useRef('');
  const mode = snap?.timer.mode ?? 'focus';
  const running = snap?.timer.running ?? false;
  const remainingMs = snap?.remainingMs ?? 0;
  const label = LABELS[mode];

  useEffect(() => {
    if (!store.isPreview) return;
    const total = Math.max(0, Math.ceil(remainingMs / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const next = `${running ? `${mm}:${ss}` : label} · Daybook`;
    if (next !== lastTitle.current) {
      lastTitle.current = next;
      document.title = next;
    }
  }, [remainingMs, running, label, store.isPreview]);

  const clock = useMemo(() => {
    const total = Math.max(0, Math.ceil(remainingMs / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }, [remainingMs]);

  const totalMs = snap?.totalMs ?? 0;
  const hasSpentTime = Boolean(snap?.timer.startedAt) && totalMs - remainingMs >= 60_000;

  return {
    mode,
    running,
    remainingMs,
    totalMs,
    progress: snap?.progress ?? 0,
    label,
    clock,
    round: snap?.timer.round ?? 0,
    roundsBeforeLong,
    tag: snap?.timer.tag ?? '',
    completed: snap?.timer.completed ?? 0,
    customMinutes: snap?.timer.customMinutes ?? 30,
    focusMin,
    shortMin,
    longMin,
    hasSpentTime,
    send,
    start: () => send({ type: 'start' }),
    pause: () => send({ type: 'pause' }),
    toggle: () => send({ type: 'toggle' }),
    reset: () => send({ type: 'reset' }),
    skip: () => send({ type: 'skip' }),
    stop: () => send({ type: 'stop' }),
    setMode: (m) => send({ type: 'setMode', mode: m }),
    setTag: (tag) => send({ type: 'setTag', tag }),
    setCustomMinutes: (minutes) => send({ type: 'setCustomMinutes', minutes }),
  };
}

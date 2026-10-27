/**
 * Pomodoro service — lives in the MAIN process on purpose.
 *
 * The running session is represented as an absolute end timestamp, not a
 * countdown of accumulated ticks. That means the timer keeps perfect time while
 * the window is minimised, hidden in the tray, reloaded, or the whole app is
 * restarted: on boot we simply compare `endsAt` with the wall clock.
 *
 * The ticker only exists while a session is running, so idle CPU stays at zero.
 */

import type { DaybookData, FocusSession, TimerMode } from '../src/lib/schema';
import type { Action } from '../src/lib/reducer';
import type { SessionCompleteInfo, TimerCommand, TimerSnapshot } from '../src/lib/ipc';
import type { Storage } from './storage';
import { toKey } from '../src/lib/date';

export type { SessionCompleteInfo };

export interface TimerHost {
  dispatch(action: Action): DaybookData;
  onTick(snapshot: TimerSnapshot): void;
  onComplete(info: SessionCompleteInfo): void;
}

const TICK_MS = 250;

export class PomodoroService {
  private interval: NodeJS.Timeout | null = null;
  private lastPushedSecond = -1;

  constructor(
    private storage: Storage,
    private host: TimerHost,
  ) {}

  private get data(): DaybookData {
    return this.storage.get();
  }

  totalMsFor(mode: TimerMode, data: DaybookData = this.data): number {
    const p = data.settings.pomodoro;
    const minutes =
      mode === 'focus'
        ? p.focusMin
        : mode === 'short'
          ? p.shortBreakMin
          : mode === 'long'
            ? p.longBreakMin
            : data.timer.customMinutes;
    return Math.max(60_000, Math.round(minutes) * 60_000);
  }

  remainingMs(): number {
    const t = this.data.timer;
    if (t.running && t.endsAt) return Math.max(0, t.endsAt - Date.now());
    return Math.max(0, Math.min(t.remainingMs, this.totalMsFor(t.mode)));
  }

  snapshot(): TimerSnapshot {
    const timer = this.data.timer;
    const totalMs = this.totalMsFor(timer.mode);
    const remainingMs = this.remainingMs();
    return {
      timer,
      remainingMs,
      totalMs,
      progress: totalMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) : 0,
    };
  }

  /** Called once at startup: resumes a live session or closes an overdue one. */
  reconcile(): void {
    const t = this.data.timer;
    if (!t.running || !t.endsAt) {
      // A paused timer keeps whatever it had left; clamp to the current config.
      const clamped = Math.min(t.remainingMs, this.totalMsFor(t.mode));
      if (clamped !== t.remainingMs) this.host.dispatch({ type: 'timer/set', patch: { remainingMs: clamped } });
      return;
    }
    const overdueBy = Date.now() - t.endsAt;
    if (overdueBy >= 0) {
      // The session finished while the app was closed. Log what was scheduled
      // (not the entire absence) and stop cleanly on the next mode.
      console.log('[pomodoro] closing a session that ended while closed');
      this.finishSession({ credit: true, overdue: true });
    } else {
      this.startTicker();
    }
  }

  command(cmd: TimerCommand): TimerSnapshot {
    switch (cmd.type) {
      case 'start':
        this.start();
        break;
      case 'pause':
        this.pause();
        break;
      case 'toggle':
        this.data.timer.running ? this.pause() : this.start();
        break;
      case 'reset':
        this.reset();
        break;
      case 'skip':
        // Ending a focus or custom session early logs the time actually spent
        // (if it is at least a minute); skipping a break simply moves on.
        this.finishSession({ credit: true, early: true });
        break;
      case 'stop':
        this.finishSession({ credit: true, early: true });
        break;
      case 'setMode':
        this.setMode(cmd.mode);
        break;
      case 'setTag':
        this.host.dispatch({ type: 'timer/set', patch: { tag: cmd.tag.slice(0, 24) } });
        break;
      case 'setCustomMinutes': {
        const minutes = Math.min(600, Math.max(1, Math.round(Number(cmd.minutes) || 1)));
        const patch: Partial<DaybookData['timer']> = { customMinutes: minutes };
        if (!this.data.timer.running && this.data.timer.mode === 'custom') patch.remainingMs = minutes * 60_000;
        this.host.dispatch({ type: 'timer/set', patch });
        break;
      }
      case 'resync':
        this.resync();
        break;
    }
    const snap = this.snapshot();
    this.host.onTick(snap);
    return snap;
  }

  start(): void {
    const t = this.data.timer;
    if (t.running) return;
    const remaining = this.remainingMs() || this.totalMsFor(t.mode);
    const now = Date.now();
    this.host.dispatch({
      type: 'timer/set',
      patch: {
        running: true,
        endsAt: now + remaining,
        remainingMs: remaining,
        startedAt: t.mode === 'focus' || t.mode === 'custom' ? now : t.startedAt,
      },
    });
    this.startTicker();
    this.host.onTick(this.snapshot());
  }

  pause(): void {
    const t = this.data.timer;
    if (!t.running) return;
    this.host.dispatch({
      type: 'timer/set',
      patch: { running: false, remainingMs: this.remainingMs(), endsAt: null },
    });
    this.stopTicker();
    this.host.onTick(this.snapshot());
  }

  reset(): void {
    const t = this.data.timer;
    this.stopTicker();
    this.host.dispatch({
      type: 'timer/set',
      patch: { running: false, endsAt: null, remainingMs: this.totalMsFor(t.mode), startedAt: null },
    });
    this.host.onTick(this.snapshot());
  }

  setMode(mode: TimerMode): void {
    this.stopTicker();
    this.host.dispatch({
      type: 'timer/set',
      patch: { mode, running: false, endsAt: null, remainingMs: this.totalMsFor(mode), startedAt: null },
    });
    this.host.onTick(this.snapshot());
  }

  /** After the user edits lengths in Settings. */
  resync(): void {
    const t = this.data.timer;
    if (t.running && t.endsAt) {
      // Keep the wall-clock end time; just re-derive the total for the ratio.
      this.host.onTick(this.snapshot());
      return;
    }
    this.host.dispatch({ type: 'timer/set', patch: { remainingMs: this.totalMsFor(t.mode) } });
    this.host.onTick(this.snapshot());
  }

  private startTicker(): void {
    if (this.interval) return;
    this.lastPushedSecond = -1;
    this.interval = setInterval(() => this.tick(), TICK_MS);
    // Never hold the event loop open just for a timer.
    this.interval.unref?.();
  }

  stopTicker(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private tick(): void {
    const t = this.data.timer;
    if (!t.running || !t.endsAt) {
      this.stopTicker();
      return;
    }
    const remaining = this.remainingMs();
    const second = Math.ceil(remaining / 1000);
    if (remaining <= 0) {
      this.finishSession({ credit: true });
      return;
    }
    if (second !== this.lastPushedSecond) {
      this.lastPushedSecond = second;
      this.host.onTick(this.snapshot());
    }
  }

  /**
   * Ends the current session and rolls to the next one.
   *
   * `credit` decides whether a focus/custom session is written into the day's
   * log. `early` marks a deliberate end before the timer ran out, which logs
   * the time actually spent — but only once a full minute has passed.
   * `overdue` means the session ran out while the app was closed, so we credit
   * exactly the scheduled length rather than the hours of absence.
   */
  private finishSession({ credit, early = false, overdue = false }: { credit: boolean; early?: boolean; overdue?: boolean }): void {
    const t = this.data.timer;
    const mode = t.mode;
    const tag = t.tag || this.data.settings.lastTag || 'Focus';
    const isWork = mode === 'focus' || mode === 'custom';
    let minutes = 0;
    let date: string | undefined;

    if (isWork && credit) {
      const configured = mode === 'focus' ? this.data.settings.pomodoro.focusMin : t.customMinutes;
      const elapsedMin = t.startedAt ? (Date.now() - t.startedAt) / 60_000 : 0;
      if (overdue) minutes = Math.round(configured);
      else if (early) minutes = elapsedMin >= 1 ? Math.max(1, Math.round(elapsedMin)) : 0;
      else minutes = Math.max(1, Math.min(Math.round(elapsedMin), Math.round(configured) + 2));

      if (minutes > 0) {
        date = toKey();
        const session: Omit<FocusSession, 'id'> = {
          tag,
          startedAt: new Date(t.startedAt ?? Date.now() - minutes * 60_000).toISOString(),
          minutes,
          auto: true,
        };
        this.host.dispatch({ type: 'session/add', date, session });
        this.host.dispatch({ type: 'settings/update', patch: { lastTag: tag } });
      }
    }

    // Custom runs stay custom: the ring returns to the same length, ready again.
    if (mode === 'custom') {
      const total = this.totalMsFor('custom');
      this.host.dispatch({
        type: 'timer/set',
        patch: { running: false, endsAt: null, remainingMs: total, startedAt: null, completed: t.completed + 1 },
      });
      this.stopTicker();
      if (minutes > 0) this.host.onComplete({ mode, tag, minutes, nextMode: 'custom', autoStarted: false, date });
      this.host.onTick(this.snapshot());
      return;
    }

    // Only a focus session that ran its full length consumes a round: stopping
    // one early still rolls to a break, but the round dots do not advance.
    const completedFully = credit && !early;
    const round = mode === 'focus' && completedFully ? t.round + 1 : t.round;
    const p = this.data.settings.pomodoro;
    const nextMode: TimerMode =
      mode === 'focus'
        ? completedFully && round > 0 && round % Math.max(1, p.roundsBeforeLong) === 0
          ? 'long'
          : 'short'
        : 'focus';
    const autoStart = mode === 'focus' ? p.autoStartBreaks : p.autoStartFocus;
    const total = this.totalMsFor(nextMode);

    this.host.dispatch({
      type: 'timer/set',
      patch: {
        mode: nextMode,
        round,
        running: autoStart,
        endsAt: autoStart ? Date.now() + total : null,
        remainingMs: total,
        startedAt: null,
        completed: t.completed + 1,
      },
    });

    if (autoStart) this.startTicker();
    else this.stopTicker();

    // A break that ends announces itself; a focus run only announces a logged one.
    if (mode !== 'focus' || minutes > 0) this.host.onComplete({ mode, tag, minutes, nextMode, autoStarted: autoStart, date });
    this.host.onTick(this.snapshot());
  }

}

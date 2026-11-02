/**
 * Browser fallback bridge.
 *
 * Daybook is an Electron app: every disk write, notification and tray action
 * goes through the preload bridge. But the renderer is a plain React app, so
 * when `window.daybook` is missing (running the UI in a browser, or a design
 * review harness) we stand in an in-memory implementation of the same
 * interface. Same reducer, same state shape, nothing persisted.
 *
 * This is deliberately small: it exists so the interface can be inspected and
 * automated tests can drive it. It is never used inside Electron.
 */

import type { BootPayload, BridgeEvent, DaybookBridge, TimerCommand, TimerSnapshot } from './ipc';
import { applyAction, type Action } from './reducer';
import { defaultData, type DaybookData, type Settings, type TimerMode } from './schema';
import { toKey } from './date';

type Listener = (payload: unknown) => void;

export function createMockBridge(): DaybookBridge {
  let data: DaybookData = applyAction(defaultData(), { type: 'data/reset', seed: true });
  const listeners: Record<BridgeEvent, Set<Listener>> = {
    data: new Set(),
    timer: new Set(),
    theme: new Set(),
    signal: new Set(),
  };
  let ticker: number | null = null;

  const emit = (event: BridgeEvent, payload: unknown) => {
    for (const l of listeners[event]) l(payload);
  };

  const darkMq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const totalFor = (mode: TimerMode): number => {
    const p = data.settings.pomodoro;
    return (mode === 'focus' ? p.focusMin : mode === 'short' ? p.shortBreakMin : mode === 'long' ? p.longBreakMin : data.timer.customMinutes) * 60_000;
  };

  const remaining = (): number => {
    const t = data.timer;
    if (t.running && t.endsAt) return Math.max(0, t.endsAt - Date.now());
    return Math.max(0, t.remainingMs);
  };

  const snapshot = (): TimerSnapshot => {
    const totalMs = totalFor(data.timer.mode);
    const rem = remaining();
    return { timer: data.timer, remainingMs: rem, totalMs, progress: Math.min(1, Math.max(0, 1 - rem / totalMs)) };
  };

  const apply = (action: Action) => {
    data = applyAction(data, action);
    emit('data', data);
  };

  const finish = (credit: boolean, early = false) => {
    const t = data.timer;
    const isWork = t.mode === 'focus' || t.mode === 'custom';
    const elapsedMin = t.startedAt ? (Date.now() - t.startedAt) / 60_000 : 0;
    const minutes = !credit || !isWork || (early && elapsedMin < 1) ? 0 : Math.max(1, Math.round(elapsedMin));
    if (minutes > 0) {
      apply({ type: 'session/add', date: toKey(), session: { tag: t.tag, startedAt: new Date(t.startedAt ?? Date.now()).toISOString(), minutes, auto: true } });
    }

    if (t.mode === 'custom') {
      const total = totalFor('custom');
      apply({ type: 'timer/set', patch: { running: false, endsAt: null, remainingMs: total, startedAt: null, completed: t.completed + 1 } });
      stopTicker();
      if (minutes > 0) {
        emit('signal', { kind: 'sessionComplete', info: { mode: 'custom', tag: t.tag, minutes, nextMode: 'custom', autoStarted: false, date: toKey() } });
      }
      return;
    }

    const p = data.settings.pomodoro;
    const round = credit && t.mode === 'focus' ? t.round + 1 : t.round;
    const nextMode: TimerMode = t.mode === 'focus' ? (round % p.roundsBeforeLong === 0 ? 'long' : 'short') : 'focus';
    const auto = t.mode === 'focus' ? p.autoStartBreaks : p.autoStartFocus;
    const total = totalFor(nextMode);
    apply({
      type: 'timer/set',
      patch: {
        mode: nextMode,
        round,
        running: auto,
        endsAt: auto ? Date.now() + total : null,
        remainingMs: total,
        startedAt: null,
        completed: t.completed + 1,
      },
    });
    if (t.mode !== 'focus' || minutes > 0) {
      emit('signal', {
        kind: t.mode === 'focus' ? 'sessionComplete' : 'breakComplete',
        info: { mode: t.mode, tag: t.tag, minutes, nextMode, autoStarted: auto, date: toKey() },
      });
    }
    if (auto) startTicker();
    else stopTicker();
  };

  const startTicker = () => {
    if (ticker !== null) return;
    ticker = window.setInterval(() => {
      if (!data.timer.running || !data.timer.endsAt) return stopTicker();
      if (remaining() <= 0) return finish(true);
      emit('timer', snapshot());
    }, 250);
  };

  const stopTicker = () => {
    if (ticker !== null) {
      window.clearInterval(ticker);
      ticker = null;
    }
  };

  const bootPayload = (): BootPayload => ({
    data,
    dark: Boolean(darkMq?.matches),
    systemDark: Boolean(darkMq?.matches),
    version: '1.3.0-preview',
    platform: 'win32',
    isPackaged: false,
    maximized: false,
    fullScreen: Boolean(document.fullscreenElement),
    dataDir: '(browser preview — nothing is written to disk)',
    forceOnboarding: false,
    shortcut: { accelerator: data.settings.globalShortcut, ok: true },
  });

  const filter = (event: BridgeEvent, cb: Listener) => {
    listeners[event].add(cb);
    return () => listeners[event].delete(cb);
  };

  return {
    isElectron: true,
    boot: async () => bootPayload(),
    dispatch: async (action: Action) => {
      apply(action);
      return { ok: true };
    },
    replaceData: async (next: DaybookData) => {
      data = next;
      emit('data', data);
      return { ok: true };
    },
    clearData: async ({ seed }: { seed: boolean }) => {
      data = applyAction(data, { type: 'data/reset', seed });
      emit('data', data);
      return { ok: true, data };
    },
    exportData: async () => ({ ok: true, path: '(browser preview — blocked)' }),
    importData: async () => ({ ok: false, canceled: true }),
    openDataFolder: async () => ({ ok: false }),
    window: {
      minimize: () => undefined,
      toggleMaximize: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      },
      close: () => window.close(),
      isMaximized: async () => Boolean(document.fullscreenElement),
      setFullScreen: async (on: boolean) => {
        if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
        if (!on && document.fullscreenElement) await document.exitFullscreen();
        return on;
      },
    },
    theme: {
      set: async (mode: Settings['theme']) => {
        apply({ type: 'settings/update', patch: { theme: mode } });
        const dark = mode === 'system' ? Boolean(darkMq?.matches) : mode === 'dark';
        return { dark, mode };
      },
      get: async () => ({
        dark: Boolean(darkMq?.matches),
        systemDark: Boolean(darkMq?.matches),
        mode: data.settings.theme,
      }),
    },
    timer: {
      send: async (cmd: TimerCommand) => {
        const t = data.timer;
        switch (cmd.type) {
          case 'start':
          case 'pause':
          case 'toggle': {
            const shouldRun = cmd.type === 'toggle' ? !t.running : cmd.type === 'start';
            if (shouldRun && !t.running) {
              apply({
                type: 'timer/set',
                patch: {
                  running: true,
                  endsAt: Date.now() + remaining(),
                  startedAt: t.mode === 'focus' || t.mode === 'custom' ? Date.now() : t.startedAt,
                },
              });
              startTicker();
            } else if (!shouldRun && t.running) {
              apply({ type: 'timer/set', patch: { running: false, endsAt: null, remainingMs: remaining() } });
              stopTicker();
            }
            break;
          }
          case 'reset':
            stopTicker();
            apply({ type: 'timer/set', patch: { running: false, endsAt: null, remainingMs: totalFor(t.mode), startedAt: null } });
            break;
          case 'skip':
          case 'stop':
            finish(true, true);
            break;
          case 'setMode':
            stopTicker();
            apply({ type: 'timer/set', patch: { mode: cmd.mode, running: false, endsAt: null, remainingMs: totalFor(cmd.mode) } });
            break;
          case 'setTag':
            apply({ type: 'timer/set', patch: { tag: cmd.tag } });
            break;
          case 'setCustomMinutes': {
            const minutes = Math.min(600, Math.max(1, Math.round(Number(cmd.minutes) || 1)));
            apply({
              type: 'timer/set',
              patch: !t.running && t.mode === 'custom' ? { customMinutes: minutes, remainingMs: minutes * 60_000 } : { customMinutes: minutes },
            });
            break;
          }
          case 'resync':
            apply({ type: 'timer/set', patch: { remainingMs: totalFor(t.mode) } });
            break;
        }
        const snap = snapshot();
        emit('timer', snap);
        return snap;
      },
      get: async () => snapshot(),
    },
    app: {
      version: async () => '1.0.0-preview',
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener');
        return { ok: true };
      },
      setLoginItem: async (enabled: boolean) => {
        apply({ type: 'settings/update', patch: { startWithWindows: enabled } });
        return { ok: true, enabled };
      },
      setShortcut: async (accelerator: string, enabled: boolean) => {
        apply({ type: 'settings/update', patch: { globalShortcut: accelerator, globalShortcutEnabled: enabled } });
        return { ok: true };
      },
      testNotification: async () => ({ ok: false, reason: 'Notifications need the desktop app.' }),
    },
    on: filter,
  };
}

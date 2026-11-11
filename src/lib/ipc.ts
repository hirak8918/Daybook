/**
 * The whole IPC contract, in one file. Main, preload and renderer all import
 * it, so a channel can never drift out of sync with its handler.
 *
 * Security posture: the renderer is sandboxed with contextIsolation on and
 * nodeIntegration off. Everything below is an explicit, validated, named
 * channel — there is no generic "run this" escape hatch.
 */

import type { DaybookData, Settings, TimerMode, TimerState } from './schema';
import type { Action } from './reducer';

export const CH = {
  boot: 'app:boot',
  dispatch: 'data:dispatch',
  replace: 'data:replace',
  clear: 'data:clear',
  export: 'data:export',
  import: 'data:import',
  openDataFolder: 'data:openFolder',
  chooseDataFolder: 'data:chooseFolder',

  winMinimize: 'window:minimize',
  winToggleMaximize: 'window:toggleMaximize',
  winClose: 'window:close',
  winIsMaximized: 'window:isMaximized',
  winSetFullScreen: 'window:setFullScreen',

  themeSet: 'theme:set',
  themeGet: 'theme:get',

  timerAction: 'timer:action',
  timerGet: 'timer:get',

  settingsPatch: 'settings:patch',
  loginItem: 'app:loginItem',
  shortcutSet: 'app:setShortcut',
  notifyTest: 'app:testNotification',
  openExternal: 'app:openExternal',
  appVersion: 'app:version',

  evtData: 'evt:data',
  evtTimer: 'evt:timer',
  evtTheme: 'evt:theme',
  evtSignal: 'evt:signal',
} as const;

export type Channel = (typeof CH)[keyof typeof CH];

/** Events the renderer may subscribe to. */
export type BridgeEvent = 'data' | 'timer' | 'theme' | 'signal';

export interface BootPayload {
  data: DaybookData;
  dark: boolean;
  systemDark: boolean;
  version: string;
  platform: string;
  isPackaged: boolean;
  maximized: boolean;
  fullScreen: boolean;
  dataDir: string;
  /** True when DAYBOOK_FORCE_ONBOARDING=1 — shows the Welcome screen again for testing. */
  forceOnboarding: boolean;
  /** Result of registering the global shortcut at boot, if any. */
  shortcut: { accelerator: string; ok: boolean; reason?: string };
}

export type TimerCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'reset' }
  /** End the current session early (Pomodoro) or stop a Custom run, logging
   *  the elapsed time when it is at least a minute. */
  | { type: 'skip' }
  | { type: 'stop' }
  | { type: 'setMode'; mode: TimerMode }
  | { type: 'setTag'; tag: string }
  /** Remember the last Custom length, in minutes. */
  | { type: 'setCustomMinutes'; minutes: number }
  /** Re-derive durations after the user edits the Pomodoro settings. */
  | { type: 'resync' };

export interface TimerSnapshot {
  timer: TimerState;
  remainingMs: number;
  totalMs: number;
  /** 0 → 1, how much of the current run is complete. */
  progress: number;
}

/** Details of a session that just ended, as reported by the main process. */
export interface SessionCompleteInfo {
  mode: TimerMode;
  tag: string;
  minutes: number;
  nextMode: TimerMode;
  autoStarted: boolean;
  /** ISO date key where an auto-logged focus session landed. */
  date?: string;
}

/** Signals pushed from main that the renderer reacts to (sound, flash, layout). */
export type BridgeSignal =
  | { kind: 'sessionComplete'; info: SessionCompleteInfo }
  | { kind: 'breakComplete'; info: SessionCompleteInfo }
  | { kind: 'windowState' }
  | { kind: 'tick' }
  | { kind: 'shortcutFailed'; accelerator: string; reason: string };

export interface StorageResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface ImportResult extends StorageResult {
  data?: DaybookData;
}

export interface DaybookBridge {
  readonly isElectron: true;
  boot(): Promise<BootPayload>;
  dispatch(action: Action): Promise<{ ok: boolean }>;
  replaceData(data: DaybookData): Promise<StorageResult>;
  clearData(opts: { seed: boolean }): Promise<{ ok: boolean; data: DaybookData }>;
  exportData(): Promise<StorageResult>;
  importData(): Promise<ImportResult>;
  openDataFolder(): Promise<{ ok: boolean }>;
  chooseDataFolder(): Promise<StorageResult>;
  window: {
    minimize(): void;
    toggleMaximize(): Promise<boolean>;
    close(): void;
    isMaximized(): Promise<boolean>;
    setFullScreen(on: boolean): Promise<boolean>;
  };
  theme: {
    set(mode: Settings['theme']): Promise<{ dark: boolean; mode: Settings['theme'] }>;
    get(): Promise<{ dark: boolean; systemDark: boolean; mode: Settings['theme'] }>;
  };
  timer: {
    send(cmd: TimerCommand): Promise<TimerSnapshot>;
    get(): Promise<TimerSnapshot>;
  };
  app: {
    version(): Promise<string>;
    openExternal(url: string): Promise<{ ok: boolean }>;
    setLoginItem(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }>;
    setShortcut(accelerator: string, enabled: boolean): Promise<{ ok: boolean; reason?: string }>;
    testNotification(): Promise<{ ok: boolean; reason?: string }>;
  };
  /** Returns an unsubscribe function. */
  on(event: BridgeEvent, cb: (payload: unknown) => void): () => void;
}

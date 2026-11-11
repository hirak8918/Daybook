/**
 * Preload — the only bridge between the sandboxed renderer and the main
 * process. contextIsolation is on, nodeIntegration is off, and every function
 * below maps to exactly one validated channel: the renderer cannot reach
 * `require`, `fs`, `ipcRenderer`, or an arbitrary channel name.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  CH,
  type BootPayload,
  type BridgeEvent,
  type DaybookBridge,
  type ImportResult,
  type StorageResult,
  type TimerCommand,
  type TimerSnapshot,
} from '../src/lib/ipc';
import type { Action } from '../src/lib/reducer';
import type { DaybookData, Settings } from '../src/lib/schema';

const EVENT_CHANNEL: Record<BridgeEvent, string> = {
  data: CH.evtData,
  timer: CH.evtTimer,
  theme: CH.evtTheme,
  signal: CH.evtSignal,
};

const api: DaybookBridge = {
  isElectron: true,

  boot: () => ipcRenderer.invoke(CH.boot) as Promise<BootPayload>,
  dispatch: (action: Action) => ipcRenderer.invoke(CH.dispatch, action) as Promise<{ ok: boolean }>,
  replaceData: (data: DaybookData) => ipcRenderer.invoke(CH.replace, data) as Promise<StorageResult>,
  clearData: (opts) => ipcRenderer.invoke(CH.clear, opts) as Promise<{ ok: boolean; data: DaybookData }>,
  exportData: () => ipcRenderer.invoke(CH.export) as Promise<StorageResult>,
  importData: () => ipcRenderer.invoke(CH.import) as Promise<ImportResult>,
  openDataFolder: () => ipcRenderer.invoke(CH.openDataFolder) as Promise<{ ok: boolean }>,
  chooseDataFolder: () => ipcRenderer.invoke(CH.chooseDataFolder) as Promise<StorageResult>,

  window: {
    minimize: () => void ipcRenderer.invoke(CH.winMinimize),
    toggleMaximize: () => ipcRenderer.invoke(CH.winToggleMaximize) as Promise<boolean>,
    close: () => void ipcRenderer.invoke(CH.winClose),
    isMaximized: () => ipcRenderer.invoke(CH.winIsMaximized) as Promise<boolean>,
    setFullScreen: (on: boolean) => ipcRenderer.invoke(CH.winSetFullScreen, on) as Promise<boolean>,
  },

  theme: {
    set: (mode: Settings['theme']) =>
      ipcRenderer.invoke(CH.themeSet, mode) as Promise<{ dark: boolean; mode: Settings['theme'] }>,
    get: () =>
      ipcRenderer.invoke(CH.themeGet) as Promise<{ dark: boolean; systemDark: boolean; mode: Settings['theme'] }>,
  },

  timer: {
    send: (cmd: TimerCommand) => ipcRenderer.invoke(CH.timerAction, cmd) as Promise<TimerSnapshot>,
    get: () => ipcRenderer.invoke(CH.timerGet) as Promise<TimerSnapshot>,
  },

  app: {
    version: () => ipcRenderer.invoke(CH.appVersion) as Promise<string>,
    openExternal: (url: string) => ipcRenderer.invoke(CH.openExternal, url) as Promise<{ ok: boolean }>,
    setLoginItem: (enabled: boolean) =>
      ipcRenderer.invoke(CH.loginItem, enabled) as Promise<{ ok: boolean; enabled: boolean }>,
    setShortcut: (accelerator: string, enabled: boolean) =>
      ipcRenderer.invoke(CH.shortcutSet, { accelerator, enabled }) as Promise<{ ok: boolean; reason?: string }>,
    testNotification: () => ipcRenderer.invoke(CH.notifyTest) as Promise<{ ok: boolean; reason?: string }>,
  },

  on(event: BridgeEvent, cb: (payload: unknown) => void) {
    const channel = EVENT_CHANNEL[event];
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('daybook', api);

// The window controls used by the custom title bar are pure fire-and-forget,
// so expose them as a tiny separate namespace the DOM can reach declaratively.
contextBridge.exposeInMainWorld('daybookMeta', {
  platform: process.platform,
});

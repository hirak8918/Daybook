/**
 * Daybook — main process.
 *
 * Owns: the frameless window + app-drawn caption buttons, the tray, the global
 * shortcut, Windows notifications, taskbar progress/flash, the Pomodoro
 * service, the global shortcut and the single source of truth for data.
 *
 * It deliberately has no knowledge of layout or styling; the renderer is a
 * sandboxed, nodeIntegration-free browser view that talks over a whitelisted
 * preload bridge.
 */

import {
  Menu,
  Notification,
  Tray,
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PomodoroService, type SessionCompleteInfo } from './pomodoro';
import { Storage, type WindowState } from './storage';
import { CH, type BootPayload, type TimerCommand, type TimerSnapshot } from '../src/lib/ipc';
import { applyAction, sanitizeAction, type Action } from '../src/lib/reducer';
import { DaybookData, migrate, type Settings } from '../src/lib/schema';
import { formatClock } from '../src/lib/date';

const APP_ID = 'com.daybook.app';
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? '';

/**
 * Production assets are served over a privileged custom scheme rather than
 * `file://`. That gives the renderer a real, stable origin (`app://daybook`),
 * which makes the strict CSP's `'self'` unambiguous — with `file://`, browsers
 * treat the origin as opaque and `default-src 'self'` can silently block the
 * app's own scripts, styles and fonts.
 */
const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://daybook`;

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function registerAppProtocol(): void {
  const root = path.join(__dirname, '..', 'dist');
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const target = path.normalize(path.join(root, relative || 'index.html'));
      // Never serve anything outside the bundled renderer directory.
      if (!target.startsWith(root)) return new Response('Forbidden', { status: 403 });
      return await net.fetch(pathToFileURL(target).toString(), { bypassCustomProtocolHandlers: true });
    } catch (err) {
      console.error('[protocol] failed to serve', request.url, err);
      return new Response('Not found', { status: 404 });
    }
  });
}

const THEME = {
  light: { paper: '#F4EFE6', ink: '#161412' },
  dark: { paper: '#141210', ink: '#F1EADF' },
};

/**
 * Set by `scripts/verify.mjs` before it drives the app over the DevTools
 * protocol. It changes exactly two things, both about being driven rather than
 * being used: the window is raised and kept un-throttled, because Windows
 * reports a covered window as occluded and Chromium then stops painting it —
 * which stalls anything that waits on a frame (a chart measuring itself, a
 * dialog's exit animation, a screenshot).
 */
const VERIFYING = process.env.DAYBOOK_VERIFY === '1';

/**
 * Shows the Welcome screen even when a name is already saved. Development only:
 * it exists so the screen itself can be reviewed and driven without wiping a
 * real data file. Honoured only when set to exactly `1`.
 */
const FORCE_ONBOARDING = process.env.DAYBOOK_FORCE_ONBOARDING === '1';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let storage: Storage;
let timer: PomodoroService;
let quitting = false;
let currentShortcut = '';
let shortcutReason: string | undefined;
let lastTrayTip = '';

/* ------------------------------------------------------------------ *
 * Paths & assets
 * ------------------------------------------------------------------ */

const asset = (name: string) => path.join(__dirname, 'assets', name);

function trayImage(): Electron.NativeImage {
  const file = nativeTheme.shouldUseDarkColors ? 'tray-dark.png' : 'tray-light.png';
  const img = nativeImage.createFromPath(asset(file));
  return img.isEmpty() ? nativeImage.createFromPath(asset('tray-light.png')) : img;
}

/* ------------------------------------------------------------------ *
 * Data plumbing
 * ------------------------------------------------------------------ */

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/** Apply an action in the authoritative main-process store, then persist. */
function dispatch(action: Action): DaybookData {
  const next = applyAction(storage.get(), action);
  storage.set(next);
  broadcast(CH.evtData, next);
  return next;
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

function currentDark(): boolean {
  return nativeTheme.shouldUseDarkColors;
}

function applyThemeToWindow(): void {
  if (!win || win.isDestroyed()) return;
  const dark = currentDark();
  const palette = dark ? THEME.dark : THEME.light;
  win.setBackgroundColor(palette.paper);
  refreshTrayIcon();
}

function refreshTrayIcon(): void {
  if (tray && !tray.isDestroyed()) tray.setImage(trayImage());
}

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

const DEFAULT_WINDOW: WindowState = { width: 1360, height: 900, maximized: false };

function userDataDir(): string {
  // `DAYBOOK_DATA_DIR` points the whole app (data, backups, window geometry) at
  // a scratch directory. It is how a fresh install and the upgrade of an
  // existing file are exercised without reading or writing the owner's own
  // data. Only an absolute path is accepted; anything else is ignored.
  const override = process.env.DAYBOOK_DATA_DIR;
  if (override && path.isAbsolute(override)) return override;
  return app.getPath('userData');
}

function ensureVisible(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state;
  const ok = screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return (
      state.x! < wa.x + wa.width - 120 &&
      state.x! + 240 > wa.x &&
      state.y! < wa.y + wa.height - 100 &&
      state.y! + 60 > wa.y
    );
  });
  if (ok) return state;
  // Off-screen (monitor unplugged): drop the position and let Windows centre it.
  return { width: state.width, height: state.height, maximized: state.maximized };
}

/** Keep the first-run window inside the actual work area (high-DPI laptops and
 *  scaled 1366×768 panels are smaller than the design's ideal canvas). */
function fittedDefaultWindow(): WindowState {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    width: Math.min(DEFAULT_WINDOW.width, Math.max(900, Math.round(workArea.width * 0.92))),
    height: Math.min(DEFAULT_WINDOW.height, Math.max(600, Math.round(workArea.height * 0.94))),
    maximized: false,
  };
}

function createWindow(): BrowserWindow {
  const saved = ensureVisible(storage.readWindowState(fittedDefaultWindow()));
  const dark = currentDark();
  const palette = dark ? THEME.dark : THEME.light;

  const w = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    // The caption buttons are rendered by the app (WindowControls), so the
    // native title bar is removed outright. The header row is the drag region;
    // the window remains resizable through Electron's frameless hit testing.
    frame: false,
    thickFrame: true,
    backgroundColor: palette.paper,
    autoHideMenuBar: true,
    title: 'Daybook',
    icon: nativeImage.createFromPath(asset('icon-256.png')),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      // The Pomodoro clock lives in the main process, so we can let Chromium
      // throttle the hidden renderer and save battery.
      backgroundThrottling: !VERIFYING,
    },
  });

  Menu.setApplicationMenu(null);

  w.once('ready-to-show', () => {
    if (saved.maximized) w.maximize();
    w.show();
    if (VERIFYING) {
      // Raise it over whatever else is on screen, then hand the z-order back.
      w.setAlwaysOnTop(true);
      w.focus();
      setTimeout(() => {
        if (!w.isDestroyed()) w.setAlwaysOnTop(false);
      }, 1200);
    }
  });

  // Never navigate away from the app; send real links to the default browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // In development, surface renderer console output in the terminal — the
  // DevTools window is the only other place to see it.
  if (devServerUrl) {
    w.webContents.on(
      'console-message' as never,
      (...args: unknown[]) => {
        const modern = args[1] && typeof args[1] === 'object';
        const detail = (modern ? args[1] : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] }) as {
          level: number | string;
          message: string;
          lineNumber?: number;
          sourceId?: string;
        };
        console.log(`[renderer:${detail.level}] ${detail.message}`);
      },
    );
    w.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] process gone', details.reason);
    });
    w.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`[renderer] failed to load (${code}) ${description}`);
    });
  }

  w.webContents.on('will-navigate', (event, url) => {
    const isAppUrl = devServerUrl ? url.startsWith(devServerUrl) : url.startsWith(APP_ORIGIN);
    if (!isAppUrl) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  const record = () => saveWindowState(w);
  w.on('resize', record);
  w.on('move', record);
  w.on('maximize', () => {
    record();
    broadcast(CH.evtSignal, { kind: 'windowState' });
  });
  w.on('unmaximize', () => {
    record();
    broadcast(CH.evtSignal, { kind: 'windowState' });
  });
  w.on('focus', () => {
    w.flashFrame(false);
    broadcast(CH.evtSignal, { kind: 'windowState' });
  });
  w.on('enter-full-screen', () => broadcast(CH.evtSignal, { kind: 'windowState' }));
  w.on('leave-full-screen', () => broadcast(CH.evtSignal, { kind: 'windowState' }));

  w.on('close', (event) => {
    saveWindowState(w);
    const minimizeToTray = storage.get().settings.minimizeToTray;
    if (!quitting && minimizeToTray) {
      event.preventDefault();
      w.hide();
      return;
    }
    storage.flush();
  });

  w.on('closed', () => {
    win = null;
  });

  if (devServerUrl) {
    void w.loadURL(devServerUrl);
  } else {
    void w.loadURL(`${APP_ORIGIN}/index.html`);
  }

  return w;
}

function saveWindowState(w: BrowserWindow): void {
  if (!w || w.isDestroyed()) return;
  const maximized = w.isMaximized();
  const bounds = maximized ? w.getNormalBounds() : w.getBounds();
  storage.writeWindowState({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized,
  });
}

function showWindow(): void {
  if (!win || win.isDestroyed()) {
    win = createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/* ------------------------------------------------------------------ *
 * Taskbar + notifications
 * ------------------------------------------------------------------ */

function setTaskbarProgress(progress: number, paused: boolean): void {
  if (!win || win.isDestroyed()) return;
  if (progress <= 0) {
    win.setProgressBar(-1);
    return;
  }
  win.setProgressBar(Math.min(0.999, progress), paused ? { mode: 'paused' } : { mode: 'normal' });
}

function notify(title: string, body: string, force = false, iconName = 'icon-256.png'): boolean {
  if (!force && !storage.get().settings.notifications) return false;
  if (!Notification.isSupported()) return false;
  try {
    const n = new Notification({
      title,
      body,
      silent: true, // the renderer chime is the only sound, and it is opt-in
      icon: nativeImage.createFromPath(asset(iconName)),
      timeoutType: 'default',
    });
    n.on('click', () => showWindow());
    n.show();
    return true;
  } catch (err) {
    console.error('[notify] failed', err);
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Tray
 * ------------------------------------------------------------------ */

function rebuildTrayMenu(): void {
  if (!tray) return;
  const running = storage.get().timer.running;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Daybook', click: () => showWindow() },
      { type: 'separator' },
      { label: running ? 'Pause timer' : 'Start timer', click: () => timer.command({ type: 'toggle' }) },
      { label: 'Reset timer', click: () => timer.command({ type: 'reset' }) },
      { type: 'separator' },
      {
        label: 'Quit Daybook',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray(): void {
  tray = new Tray(trayImage());
  tray.setToolTip('Daybook');
  rebuildTrayMenu();
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

function modeLabel(mode: TimerSnapshot['timer']['mode']): string {
  return mode === 'focus' ? 'Focus' : mode === 'long' ? 'Long break' : mode === 'short' ? 'Short break' : 'Custom';
}

function updateTrayTip(snapshot: TimerSnapshot): void {
  if (!tray || tray.isDestroyed()) return;
  const { timer: t, remainingMs } = snapshot;
  const tip = t.running
    ? `Daybook — ${formatClock(remainingMs)} ${modeLabel(t.mode)}`
    : `Daybook — ${modeLabel(t.mode)} paused at ${formatClock(remainingMs)}`;
  if (tip !== lastTrayTip) {
    lastTrayTip = tip;
    tray.setToolTip(tip);
  }
}

/* ------------------------------------------------------------------ *
 * Timer wiring
 * ------------------------------------------------------------------ */

function handleTick(snapshot: TimerSnapshot): void {
  broadcast(CH.evtTimer, snapshot);
  updateTrayTip(snapshot);
  setTaskbarProgress(snapshot.progress, !snapshot.timer.running);
  const { timer: t, remainingMs } = snapshot;
  // While a timer runs the window title carries the countdown (and so does the
  // taskbar button). When nothing is running the title is simply the app name.
  if (win && !win.isDestroyed()) {
    const label = modeLabel(t.mode);
    win.setTitle(t.running ? `${formatClock(remainingMs)} · ${label} — Daybook` : 'Daybook');
  }
  rebuildTrayMenu();
}

function handleComplete(info: SessionCompleteInfo): void {
  if (info.mode === 'focus' || info.mode === 'custom') {
    const nextLabel = info.nextMode === 'long' ? 'Long break' : 'Short break';
    notify(
      'Session logged',
      info.mode === 'custom' || info.nextMode === 'custom'
        ? `${info.minutes} min of ${info.tag} added to today's focus time.`
        : `${info.minutes} min of ${info.tag} added to today's focus time. ${nextLabel} is up next.`,
    );
  } else {
    notify('Break over', 'Ready to focus again when you are.');
  }
  // Flash the taskbar button but never steal focus or yank the window back into
  // view — a session ending while you are elsewhere deserves a nudge, not an
  // interruption.
  if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
  broadcast(CH.evtSignal, {
    kind: info.mode === 'focus' ? 'sessionComplete' : 'breakComplete',
    info,
  });
  rebuildTrayMenu();
}

/* ------------------------------------------------------------------ *
 * Global shortcut
 * ------------------------------------------------------------------ */

function registerShortcut(accelerator: string, enabled: boolean): { ok: boolean; reason?: string } {
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut);
    currentShortcut = '';
  }
  shortcutReason = undefined;
  if (!enabled || !accelerator) return { ok: true };
  try {
    const ok = globalShortcut.register(accelerator, () => {
      timer.command({ type: 'toggle' });
      broadcast(CH.evtSignal, { kind: 'tick' });
    });
    if (!ok) {
      shortcutReason = `Windows refused the shortcut ${accelerator} — another application is probably holding it.`;
      console.warn('[shortcut]', shortcutReason);
      return { ok: false, reason: shortcutReason };
    }
    currentShortcut = accelerator;
    return { ok: true };
  } catch (err) {
    shortcutReason = `Could not register ${accelerator}: ${(err as Error).message}`;
    console.warn('[shortcut]', shortcutReason);
    return { ok: false, reason: shortcutReason };
  }
}

/* ------------------------------------------------------------------ *
 * Boot payload + IPC
 * ------------------------------------------------------------------ */

function bootPayload(): BootPayload {
  return {
    data: storage.get(),
    dark: currentDark(),
    systemDark: nativeTheme.shouldUseDarkColors,
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    maximized: Boolean(win?.isMaximized()),
    fullScreen: Boolean(win?.isFullScreen()),
    dataDir: userDataDir(),
    forceOnboarding: FORCE_ONBOARDING,
    shortcut: {
      accelerator: storage.get().settings.globalShortcut,
      ok: !shortcutReason,
      ...(shortcutReason ? { reason: shortcutReason } : {}),
    },
  };
}

function safeFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Daybook-Edition-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

function registerIpc(): void {
  ipcMain.handle(CH.boot, () => bootPayload());

  ipcMain.handle(CH.dispatch, (_e, raw: unknown) => {
    const action = sanitizeAction(raw);
    if (!action) return { ok: false };
    dispatch(action);
    if (action.type === 'timer/set') {
      // A renderer-initiated timer edit (e.g. editing config) — keep the tray in step.
      handleTick(timer.snapshot());
    }
    return { ok: true };
  });

  ipcMain.handle(CH.replace, (_e, raw: unknown) => {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const next = migrate(parsed);
      storage.set(next);
      storage.flush();
      broadcast(CH.evtData, next);
      timer.command({ type: 'reset' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(CH.clear, (_e, opts: { seed?: boolean }) => {
    const next = applyAction(storage.get(), { type: 'data/reset', seed: Boolean(opts?.seed) });
    storage.set(next);
    storage.flush();
    broadcast(CH.evtData, next);
    timer.command({ type: 'reset' });
    return { ok: true, data: next };
  });

  ipcMain.handle(CH.export, async () => {
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export today’s archive',
      defaultPath: path.join(app.getPath('documents'), safeFileName()),
      filters: [{ name: 'Daybook archive', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(storage.get(), null, 2), 'utf8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(CH.import, async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import a Daybook archive',
      filters: [{ name: 'Daybook archive', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    try {
      const raw = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
      const next = migrate(raw);
      // Flush (and therefore back up) the outgoing edition before replacing it,
      // so an accidental import is always recoverable from the backups folder.
      storage.flush();
      storage.set(next);
      storage.flush();
      broadcast(CH.evtData, next);
      broadcast(CH.evtTimer, timer.command({ type: 'reset' }));
      return { ok: true, path: res.filePaths[0], data: next };
    } catch (err) {
      return { ok: false, error: `That file could not be read as a Daybook archive: ${(err as Error).message}` };
    }
  });

  ipcMain.handle(CH.openDataFolder, async () => {
    await shell.openPath(userDataDir());
    return { ok: true };
  });

  ipcMain.handle(CH.winMinimize, () => win?.minimize());
  ipcMain.handle(CH.winToggleMaximize, () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle(CH.winClose, () => win?.close());
  ipcMain.handle(CH.winIsMaximized, () => Boolean(win?.isMaximized()));
  ipcMain.handle(CH.winSetFullScreen, (_e, on: boolean) => {
    win?.setFullScreen(Boolean(on));
    return Boolean(win?.isFullScreen());
  });

  ipcMain.handle(CH.themeSet, (_e, mode: Settings['theme']) => {
    const safe: Settings['theme'] = mode === 'light' || mode === 'dark' ? mode : 'system';
    nativeTheme.themeSource = safe;
    dispatch({ type: 'settings/update', patch: { theme: safe } });
    applyThemeToWindow();
    return { dark: currentDark(), mode: safe };
  });

  ipcMain.handle(CH.themeGet, () => ({
    dark: currentDark(),
    systemDark: nativeTheme.shouldUseDarkColors,
    mode: storage.get().settings.theme,
  }));

  ipcMain.handle(CH.timerGet, () => timer.snapshot());
  ipcMain.handle(CH.timerAction, (_e, cmd: TimerCommand) => timer.command(cmd));

  ipcMain.handle(CH.settingsPatch, (_e, patch: Partial<Settings>) => {
    const allowed: Partial<Settings> = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.minimizeToTray === 'boolean') allowed.minimizeToTray = patch.minimizeToTray;
      if (typeof patch.notifications === 'boolean') allowed.notifications = patch.notifications;
      if (typeof patch.startWithWindows === 'boolean') allowed.startWithWindows = patch.startWithWindows;
      if (typeof patch.globalShortcutEnabled === 'boolean') allowed.globalShortcutEnabled = patch.globalShortcutEnabled;
      if (typeof patch.globalShortcut === 'string') allowed.globalShortcut = patch.globalShortcut.slice(0, 40);
    }
    if (Object.keys(allowed).length) dispatch({ type: 'settings/update', patch: allowed });
    if (allowed.startWithWindows !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: allowed.startWithWindows, path: process.execPath });
    }
    if (allowed.globalShortcut !== undefined || allowed.globalShortcutEnabled !== undefined) {
      const s = storage.get().settings;
      return { ok: true, shortcut: registerShortcut(s.globalShortcut, s.globalShortcutEnabled) };
    }
    return { ok: true };
  });

  ipcMain.handle(CH.loginItem, (_e, enabled: boolean) => {
    const on = Boolean(enabled);
    dispatch({ type: 'settings/update', patch: { startWithWindows: on } });
    let ok = true;
    try {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on, path: process.execPath });
    } catch {
      ok = false;
    }
    const state = app.getLoginItemSettings();
    return { ok, enabled: app.isPackaged ? state.openAtLogin : on };
  });

  ipcMain.handle(CH.shortcutSet, (_e, payload: { accelerator: string; enabled: boolean }) => {
    const accel = String(payload?.accelerator ?? '').slice(0, 40);
    const enabled = Boolean(payload?.enabled);
    dispatch({ type: 'settings/update', patch: { globalShortcut: accel, globalShortcutEnabled: enabled } });
    return registerShortcut(accel, enabled);
  });

  ipcMain.handle(CH.notifyTest, () => {
    const ok = notify(
      'Daybook',
      'Notifications are working. Finishing a session will announce itself here, and the taskbar button will flash if the window is behind something else.',
      true,
    );
    return ok ? { ok: true } : { ok: false, reason: 'Windows would not raise a notification. Check Focus Assist / Do Not Disturb.' };
  });

  ipcMain.handle(CH.openExternal, async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle(CH.appVersion, () => app.getVersion());
}

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

function hardenSession(): void {
  // In development the Vite dev server injects an inline React Refresh preamble
  // and needs a websocket for HMR, so the policy is relaxed *only* for the dev
  // server. The packaged app runs the strict policy below over app://daybook.
  const scriptSrc = devServerUrl ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'" + (devServerUrl ? ' ws: http://127.0.0.1:* http://localhost:*' : ''),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });

  // Deny every permission request: the app needs none of them.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
}

/* ------------------------------------------------------------------ *
 * Auto-update
 *
 * Deliberately absent in v1.1. An updater with nothing to check (no signed
 * release, no publish feed) is a dead setting in the interface, so it is gone
 * until there is a feed to point electron-updater at.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.setAppUserModelId(APP_ID);

  app.whenReady().then(() => {
    storage = new Storage(userDataDir(), app.getVersion());

    // First launch: seed a plausible back catalogue so every chart has a story.
    if (!storage.get().meta.seeded) {
      const seeded = applyAction(storage.get(), { type: 'data/reset', seed: true });
      storage.set(seeded);
    }
    storage.set(applyAction(storage.get(), { type: 'meta/patch', patch: { launches: storage.get().meta.launches + 1 } }));
    storage.flush();

    if (!devServerUrl) registerAppProtocol();
    hardenSession();

    timer = new PomodoroService(storage, {
      dispatch,
      onTick: handleTick,
      onComplete: handleComplete,
    });

    registerIpc();
    win = createWindow();
    createTray();

    const settings = storage.get().settings;
    nativeTheme.themeSource = settings.theme;
    applyThemeToWindow();
    registerShortcut(settings.globalShortcut, settings.globalShortcutEnabled);

    timer.reconcile();
    handleTick(timer.snapshot());

    nativeTheme.on('updated', () => {
      applyThemeToWindow();
      broadcast(CH.evtTheme, {
        dark: currentDark(),
        systemDark: nativeTheme.shouldUseDarkColors,
        mode: storage.get().settings.theme,
      });
    });
  });

  app.on('window-all-closed', () => {
    // Windows: closing the last window quits, unless we are parked in the tray.
    if (!storage?.get().settings.minimizeToTray) {
      quitting = true;
      app.quit();
    }
  });

  app.on('activate', () => showWindow());

  app.on('before-quit', () => {
    quitting = true;
    timer?.stopTicker();
    storage?.flush();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    tray?.destroy();
  });
}

// Last-resort safety net: never lose the edition because of a crashed window.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught', err);
  try {
    storage?.flush();
  } catch {
    /* nothing left to do */
  }
});

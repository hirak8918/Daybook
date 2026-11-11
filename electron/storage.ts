/**
 * Storage — the only place in the app that touches the disk.
 *
 *   %APPDATA%\Daybook\daybook.json                  the live document
 *   %APPDATA%\Daybook\backups\daybook.N.json         the last five distinct saves
 *   %APPDATA%\Daybook\backups\pre-<version>-<stamp>.json  a copy taken before a migration
 *   %APPDATA%\Daybook\window.json                    window geometry (not data)
 *
 * Writes are atomic: serialise → temp file → fsync → rename over the target.
 * A crash mid-write can therefore never leave a half-written document behind.
 * Before any schema migration runs, the untouched file is copied into backups,
 * so an upgrade can always be wound back by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_VERSION, DaybookData, defaultData, migrate } from '../src/lib/schema';

const BACKUP_COUNT = 5;
const SAVE_DEBOUNCE_MS = 350;
const RETRY_MS = 5000;
const DEFAULT_APP_VERSION = '2.2.0';
/** Matches the BrowserWindow minimum in electron/main.ts. */
const MIN_WIDTH = 1000;
const MIN_HEIGHT = 600;

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export class Storage {
  readonly dir: string;
  readonly file: string;
  readonly backupDir: string;
  readonly windowFile: string;
  readonly appVersion: string;
  /** The pre-migration copy written on this launch, if a migration happened. */
  preMigrationBackup: string | null = null;

  private data: DaybookData;
  private saveTimer: NodeJS.Timeout | null = null;
  private pending: DaybookData | null = null;
  private lastBackupHash = '';
  private dirty = false;

  constructor(dir: string, appVersion = DEFAULT_APP_VERSION) {
    this.dir = dir;
    this.file = path.join(dir, 'daybook.json');
    this.backupDir = path.join(dir, 'backups');
    this.windowFile = path.join(dir, 'window.json');
    this.appVersion = appVersion;
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.data = this.read();
  }

  /**
   * Copy the raw document aside before a schema migration rewrites it. The
   * copy is byte-for-byte what was on disk, so a field the new version stopped
   * using is still recoverable.
   */
  private writePreMigrationBackup(contents: string, fromVersion: number): void {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const target = path.join(this.backupDir, `pre-${this.appVersion}-${stamp}.json`);
      const fd = fs.openSync(target, 'w');
      try {
        fs.writeFileSync(fd, contents, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      this.preMigrationBackup = target;
      console.log(`[storage] pre-migration copy of v${fromVersion} written to ${target}`);
    } catch (err) {
      // Never block the app from starting because a courtesy copy failed.
      console.error('[storage] pre-migration backup failed', err);
    }
  }

  private read(): DaybookData {
    try {
      if (!fs.existsSync(this.file)) return defaultData();
      const text = fs.readFileSync(this.file, 'utf8');
      const raw = JSON.parse(text);
      const fromVersion = Number(raw?.version ?? 0);
      if (Number.isFinite(fromVersion) && fromVersion < DATA_VERSION) {
        this.writePreMigrationBackup(text, fromVersion);
      }
      const migrated = migrate(raw);
      if (raw?.version !== migrated.version) {
        console.log(`[storage] migrated data v${raw?.version ?? '?'} → v${migrated.version}`);
      }
      return migrated;
    } catch (err) {
      console.error('[storage] failed to read daybook.json, trying backups', err);
      // Fall back to the newest readable backup rather than throwing away work.
      for (let i = 1; i <= BACKUP_COUNT; i++) {
        const candidate = path.join(this.backupDir, `daybook.${i}.json`);
        try {
          if (!fs.existsSync(candidate)) continue;
          const restored = migrate(JSON.parse(fs.readFileSync(candidate, 'utf8')));
          console.warn(`[storage] recovered from backup ${i}`);
          return restored;
        } catch {
          /* keep trying */
        }
      }
      return defaultData();
    }
  }

  get(): DaybookData {
    return this.data;
  }

  set(data: DaybookData): void {
    this.data = data;
    this.scheduleSave();
  }

  /** Debounced write — the UI can mutate on every keystroke. */
  scheduleSave(): void {
    this.dirty = true;
    this.pending = this.data;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Immediate, synchronous write (used on quit and after imports).
   *
   * A failed save never throws: the debounce timer that calls this runs outside
   * any request, so an exception here would be fatal to the process (and the
   * data would still be unsaved). Instead the failure is logged, the document
   * stays dirty, and the next flush tries again.
   */
  flush(): void {
    if (!this.dirty || !this.pending) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const payload = JSON.stringify(this.pending, null, 2);
    try {
      this.writeAtomic(this.file, payload);
    } catch (err) {
      // Keep the document dirty and try again in a moment (a locked file or a
      // temporarily unavailable drive is usually gone by then) — but never in a
      // tight loop, and never in a way that keeps the process alive.
      this.dirty = true;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.flush();
      }, RETRY_MS);
      this.saveTimer.unref?.();
      console.error('[storage] save failed — the document stays unsaved and will be retried', err);
      return;
    }
    this.rotateBackup(payload);
    this.dirty = false;
    this.pending = null;
  }

  private writeAtomic(target: string, contents: string): void {
    const tmp = `${target}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, contents, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  }

  /**
   * Rolling window of the last five *distinct* saves. Identical snapshots are
   * not duplicated (typing in a note should not evict a useful restore point).
   */
  private rotateBackup(payload: string): void {
    let hash = 0;
    const sample = payload.length > 4096 ? payload.slice(0, 2048) + payload.slice(-2048) + payload.length : payload;
    for (let i = 0; i < sample.length; i++) hash = (Math.imul(31, hash) + sample.charCodeAt(i)) | 0;
    const key = `${hash}:${payload.length}`;
    if (key === this.lastBackupHash) return;
    this.lastBackupHash = key;

    for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
      const from = path.join(this.backupDir, `daybook.${i}.json`);
      const to = path.join(this.backupDir, `daybook.${i + 1}.json`);
      if (fs.existsSync(from)) {
        try {
          fs.renameSync(from, to);
        } catch {
          /* best effort */
        }
      }
    }
    try {
      fs.writeFileSync(path.join(this.backupDir, 'daybook.1.json'), payload, 'utf8');
    } catch (err) {
      console.error('[storage] backup failed', err);
    }
  }

  listBackups(): { name: string; path: string; size: number; modified: number }[] {
    try {
      return fs
        .readdirSync(this.backupDir)
        .filter((f) => f.endsWith('.json'))
        .map((name) => {
          const p = path.join(this.backupDir, name);
          const st = fs.statSync(p);
          return { name, path: p, size: st.size, modified: st.mtimeMs };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  /* ----------------------------- window state ---------------------------- */

  readWindowState(fallback: WindowState): WindowState {
    try {
      if (!fs.existsSync(this.windowFile)) return fallback;
      const raw = JSON.parse(fs.readFileSync(this.windowFile, 'utf8')) as Partial<WindowState>;
      return {
        x: typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : undefined,
        y: typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : undefined,
        // The window minimum in v1.1 is 1000×600; older saved states are lifted.
        width: Math.max(MIN_WIDTH, Math.round(raw.width ?? fallback.width)),
        height: Math.max(MIN_HEIGHT, Math.round(raw.height ?? fallback.height)),
        maximized: Boolean(raw.maximized),
      };
    } catch {
      return fallback;
    }
  }

  writeWindowState(state: WindowState): void {
    try {
      this.writeAtomic(this.windowFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[storage] window state failed', err);
    }
  }
}

import { useEffect, useState } from 'react';
import { useBoot, useData, useStoreApi } from '../lib/store';
import { DEFAULT_CUSTOM_MINUTES } from '../lib/schema';
import { Segmented } from '../components/Segmented';
import { Toggle } from '../components/Toggle';
import { cleanName, nameError } from '../lib/name';
import { ConfirmDialog, type Notice } from '../components/Overlays';
import { IconDownload, IconFolder, IconTrash, IconUpload } from '../components/Icons';

/** Clamp table for every number in Settings (also enforced in the schema). */
export const LIMITS = {
  goalFocus: [15, 720],
  goalTasks: [1, 20],
  timerFocus: [1, 180],
  timerShort: [1, 60],
  timerLong: [1, 90],
  timerRounds: [2, 12],
} as const;

const THEMES = [
  { id: 'system' as const, label: 'Auto' },
  { id: 'light' as const, label: 'Light' },
  { id: 'dark' as const, label: 'Dark' },
];

/**
 * Settings — four plain cards, no Save button, no numbered headings and no
 * explanatory paragraphs. Every field commits on blur or Enter, clamps to its
 * allowed range, and reverts rather than storing nonsense.
 */
export function SettingsView({ onNotice }: { onNotice: (notice: Omit<Notice, 'id'>) => void }) {
  const data = useData();
  const store = useStoreApi();
  const boot = useBoot();
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [eraseOpen, setEraseOpen] = useState(false);

  const { goals, pomodoro } = data.settings;

  useEffect(() => {
    setShortcutError(boot?.shortcut.ok === false ? (boot.shortcut.reason ?? 'Windows refused the shortcut.') : null);
  }, [boot?.shortcut]);

  const setGoal = (key: 'deepWorkMin' | 'tasks', value: number) => {
    store.dispatch({ type: 'settings/goals', patch: { [key]: value } });
  };

  const setTimer = (key: 'focusMin' | 'shortBreakMin' | 'longBreakMin' | 'roundsBeforeLong', value: number) => {
    store.dispatch({ type: 'settings/pomodoro', patch: { [key]: value } });
    // The running session keeps its own end time; the next one picks this up.
    void store.bridge.timer.send({ type: 'resync' });
  };

  const setFlag = (patch: Partial<typeof data.settings>) => {
    store.dispatch({ type: 'settings/update', patch });
  };

  const exportData = async () => {
    const result = await store.bridge.exportData();
    if (result.ok) onNotice({ tone: 'good', title: 'Exported', body: result.path });
    else if (!result.canceled) onNotice({ tone: 'warn', title: 'Export failed', body: result.error });
  };

  const importData = async () => {
    const result = await store.bridge.importData();
    if (result.canceled || !result.ok) {
      if (!result.canceled) onNotice({ tone: 'warn', title: 'Import failed', body: result.error });
      return;
    }
    onNotice({ tone: 'good', title: 'Imported', body: result.path });
  };

  const chooseDataFolder = async () => {
    const result = await store.bridge.chooseDataFolder();
    if (result.ok) {
      onNotice({
        tone: 'good',
        title: 'Data folder changed',
        body: 'Daybook is restarting in the selected folder.',
      });
    } else if (!result.canceled) {
      onNotice({ tone: 'warn', title: 'Could not change the data folder', body: result.error });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-4">
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-3">
        {/* ------------------------------------------------------- goals */}
        <section className="card" aria-labelledby="set-goals">
          <div className="card-head">
            <h2 id="set-goals" className="font-text text-small font-semibold text-ink">
              Goals
            </h2>
          </div>
          <div className="card-body flex flex-col gap-1">
            <NumberRow
              label="Focus"
              suffix="min"
              value={goals.deepWorkMin}
              limit={LIMITS.goalFocus}
              onCommit={(value) => setGoal('deepWorkMin', value)}
            />
            <NumberRow
              label="Tasks"
              suffix="per day"
              value={goals.tasks}
              limit={LIMITS.goalTasks}
              onCommit={(value) => setGoal('tasks', value)}
            />
          </div>
        </section>

        {/* --------------------------------------------------------- app */}
        <section className="card" aria-labelledby="set-app">
          <div className="card-head">
            <h2 id="set-app" className="font-text text-small font-semibold text-ink">
              App
            </h2>
          </div>
          <div className="card-body flex flex-col gap-1">
            <NameRow
              value={data.profile?.name ?? ''}
              onCommit={(name) => store.dispatch({ type: 'profile/set-name', name })}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="font-text text-small text-ink">Theme</span>
              <Segmented label="Theme" value={data.settings.theme} onChange={(mode) => void store.setTheme(mode)} options={THEMES} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 font-text text-small text-ink">
                Notifications
                <button
                  className="btn-text"
                  onClick={async () => {
                    const result = await store.bridge.app.testNotification();
                    onNotice(
                      result.ok
                        ? { tone: 'good', title: 'Test notification sent' }
                        : { tone: 'warn', title: 'Notifications blocked', body: result.reason },
                    );
                  }}
                >
                  Test
                </button>
              </span>
              <Toggle
                label="Notifications"
                checked={data.settings.notifications}
                onChange={(next) => setFlag({ notifications: next })}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate font-text text-small text-ink">Start with Windows</span>
                <Toggle
                  label="Start with Windows"
                  checked={data.settings.startWithWindows}
                  onChange={async (next) => {
                    const result = await store.bridge.app.setLoginItem(next);
                    if (!result.ok) onNotice({ tone: 'warn', title: 'Windows refused the startup entry' });
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate font-text text-small text-ink">Close to tray</span>
                <Toggle
                  label="Close to tray"
                  checked={data.settings.minimizeToTray}
                  onChange={(next) => setFlag({ minimizeToTray: next })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2 font-text text-small text-ink">
                Shortcut
                <span className="font-mono text-micro text-ink-mute">Ctrl+Alt+P</span>
              </span>
              <Toggle
                label="Global shortcut"
                checked={data.settings.globalShortcutEnabled}
                onChange={async (next) => {
                  const result = await store.bridge.app.setShortcut(data.settings.globalShortcut, next);
                  setShortcutError(result.ok ? null : (result.reason ?? 'Windows refused the shortcut.'));
                }}
              />
            </div>
            {shortcutError ? <p className="font-text text-micro text-accent-deep">{shortcutError}</p> : null}
          </div>
        </section>

        {/* ------------------------------------------------------- timer */}
        <section className="card" id="set-timer" aria-labelledby="set-timer-heading">
          <div className="card-head">
            <h2 id="set-timer-heading" className="font-text text-small font-semibold text-ink">
              Timer
            </h2>
          </div>
          <div className="card-body flex flex-col gap-1">
            <div className="grid grid-cols-5 gap-x-2">
              <CompactField
                label="Focus"
                suffix="min"
                value={pomodoro.focusMin}
                limit={LIMITS.timerFocus}
                onCommit={(value) => setTimer('focusMin', value)}
              />
              <CompactField
                label="Short"
                suffix="min"
                value={pomodoro.shortBreakMin}
                limit={LIMITS.timerShort}
                onCommit={(value) => setTimer('shortBreakMin', value)}
              />
              <CompactField
                label="Long"
                suffix="min"
                value={pomodoro.longBreakMin}
                limit={LIMITS.timerLong}
                onCommit={(value) => setTimer('longBreakMin', value)}
              />
              <CompactField
                label="After"
                suffix="rounds"
                value={pomodoro.roundsBeforeLong}
                limit={LIMITS.timerRounds}
                onCommit={(value) => setTimer('roundsBeforeLong', value)}
              />
              <CompactField
                label="Custom"
                suffix="min"
                value={data.timer.customMinutes || DEFAULT_CUSTOM_MINUTES}
                limit={[1, 600]}
                onCommit={(value) => {
                  void store.bridge.timer.send({ type: 'setCustomMinutes', minutes: value });
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-text text-small text-ink">Auto-start breaks</span>
              <Toggle
                label="Auto-start breaks"
                checked={pomodoro.autoStartBreaks}
                onChange={(next) => store.dispatch({ type: 'settings/pomodoro', patch: { autoStartBreaks: next } })}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-text text-small text-ink">Auto-start focus</span>
              <Toggle
                label="Auto-start focus"
                checked={pomodoro.autoStartFocus}
                onChange={(next) => store.dispatch({ type: 'settings/pomodoro', patch: { autoStartFocus: next } })}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-text text-small text-ink">Sound at the end</span>
              <Toggle
                label="Sound at the end of a session"
                checked={pomodoro.chimeSound}
                onChange={(next) => store.dispatch({ type: 'settings/pomodoro', patch: { chimeSound: next } })}
              />
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- data */}
        <section className="card" aria-labelledby="set-data">
          <div className="card-head">
            <h2 id="set-data" className="font-text text-small font-semibold text-ink">
              Data
            </h2>
          </div>
          <div className="card-body flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => void exportData()}>
                <IconDownload size={15} /> Export
              </button>
              <button className="btn" onClick={() => void importData()}>
                <IconUpload size={15} /> Import
              </button>
              <button className="btn" onClick={() => void store.bridge.openDataFolder()}>
                <IconFolder size={15} /> Open folder
              </button>
            </div>
            <div className="flex min-w-0 items-center gap-2 border-t border-rule pt-2">
              <span className="min-w-0 flex-1 truncate font-text text-micro text-ink-mute" title={boot?.dataDir}>
                {boot?.dataDir ?? 'Loading folder…'}
              </span>
              <button className="btn-text shrink-0" onClick={() => void chooseDataFolder()}>
                Change folder
              </button>
            </div>
            <div className="mt-auto">
              <button className="btn border-accent text-accent-deep" onClick={() => setEraseOpen(true)}>
                <IconTrash size={15} /> Erase all data
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-end">
        <p className="font-text text-micro text-ink-mute">
          Daybook <span className="font-mono">{boot?.version ?? '2.2.0'}</span>
        </p>
      </footer>

      <ConfirmDialog
        open={eraseOpen}
        title="Erase all data?"
        body={
          <>
            <p>A backup is written first, then every note, session, movement entry and task is removed.</p>
            <p>This cannot be undone from inside Daybook — the backup file is the way back.</p>
          </>
        }
        confirmLabel="Erase everything"
        requireTyped="DELETE"
        onCancel={() => setEraseOpen(false)}
        onConfirm={() => {
          setEraseOpen(false);
          void store.clearAll(false).then(() => {
            onNotice({ tone: 'warn', title: 'All data erased', body: 'A backup was written to %APPDATA%\\Daybook\\backups.' });
          });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Fields
 * ------------------------------------------------------------------ */

function NameRow({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = cleanName(draft);
    if (nameError(next) || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="font-text text-small text-ink">Name</span>
      <input
        className="namefield"
        type="text"
        value={draft}
        aria-label="Your name"
        maxLength={48}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function CompactField({
  label,
  suffix,
  value,
  limit,
  onCommit,
}: {
  label: string;
  suffix: string;
  value: number;
  limit: readonly [number, number];
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(limit[1], Math.max(limit[0], Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="font-text text-micro font-medium text-ink-mute">{label}</span>
      <input
        className="numfield w-full"
        type="number"
        min={limit[0]}
        max={limit[1]}
        value={draft}
        aria-label={`${label} in ${suffix}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function NumberRow({
  label,
  suffix,
  value,
  limit,
  onCommit,
}: {
  label: string;
  suffix: string;
  value: number;
  limit: readonly [number, number];
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(limit[1], Math.max(limit[0], Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="font-text text-small text-ink">{label}</span>
      <span className="flex items-center gap-2">
        <input
          className="numfield"
          type="number"
          min={limit[0]}
          max={limit[1]}
          value={draft}
          aria-label={`${label} in ${suffix}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(String(value));
              event.currentTarget.blur();
            }
          }}
        />
        <span className="w-[3.5rem] font-text text-micro text-ink-mute">{suffix}</span>
      </span>
    </label>
  );
}

# Daybook

**Notes, tasks and focus time, in one quiet window.**

Daybook is a Windows desktop notebook for the work in front of you. Keep titled
notes in one library, a daily task list that carries unfinished work forward,
then start a focus session on the Timer. Activity shows what the week actually
looked like. One window, one JSON file, no account, no network code.

**Latest release:** [v2.2.0](../../releases/latest) · Windows 10/11 x64 · [MIT licence](LICENSE)

![Daybook's Welcome screen: a cream page with the wordmark and the single question "What should we call you?" above a boxed name field](docs/screenshots/welcome.webp)

## Contents

- [Download](#download)
- [What it does](#what-it-does)
- [Screens](#screens)
- [Where your data lives](#where-your-data-lives)
- [Build from source](#build-from-source)
- [Release assets](#release-assets)
- [Keyboard](#keyboard)
- [Architecture](#architecture)
- [Testing](#testing)
- [Packaging and the SmartScreen warning](#packaging-and-the-smartscreen-warning)
- [Changelog](#changelog)
- [Licence](#licence)

## Download

Grab the newest build from [**Releases**](../../releases/latest).

| File | What it is |
|---|---|
| `Daybook-Setup-2.2.0.exe` | The installer. Per-user, no admin rights, choice of folder, desktop and Start Menu shortcuts, and a clean uninstaller that leaves your data alone. |

**Requirements:** Windows 10 1809 or newer, or Windows 11, x64. 1000 × 600 is the
smallest window Daybook draws itself in.

The installer is not code-signed, so the first launch shows Windows SmartScreen:
click **More info → Run anyway**. See
[that section](#packaging-and-the-smartscreen-warning) for how to remove the
warning properly.

Portable builds are gone. There is one installer and no other target.

## What it does

| Tab | The one thing you do there |
|---|---|
| **Home** | Your notes. Each note is a titled card with a search field above the grid; open one to write with bold, italic, underline and a Word-style size menu. Focus today and the task list sit in the margin, and unfinished tasks carry over from earlier days. There is no timer button here; starting work belongs to the Timer. |
| **Timer** | Run a Pomodoro or a custom-length session. It keeps counting while minimised, in the tray, or after a restart, and logs itself when it ends. |
| **Activity** | See the shape of your focus: today, this week, the current streak, a 30-day chart and a year calendar. Click a day to correct its sessions or completed tasks. |
| **Settings** | Goals, name and theme, timer lengths, and the data tools. Four plain cards; everything saves as you type or leave the field. |

The first page is one question. No photograph, no seal, no helper copy:

> *What should we call you?*

Type a name, press Enter, and the app says it back before opening Home. The name
appears in the page title (`Today, Ada`) and as an editable **Name** row in
Settings → App. It is asked once.

On every later launch a short greeting fades in with the owner's name, the time of
day and a rotating goal prompt. It leaves after 1.9 seconds, or immediately on a
click or key press.

Notes are a library, not a daily page. Home shows each note as a card with its
title, excerpt, date and word count, and the search field filters titles and body
text. The editor autosaves 650 ms after you stop typing and has an explicit Save
button; its schema knows only paragraphs, hard breaks, bold, italic, underline
and a size mark, so pasted markup cannot smuggle anything else into the file. The
task list is one rolling list: completing an item removes it and offers Undo, and
unfinished tasks from earlier days stay visible under **Remaining from earlier**,
labelled **From yesterday** or **N days old**.

The rules the interface is built on:

1. **One screen, no scroll.** No tab, panel, sidebar or window shows a page
   scrollbar from 1000 × 600 to 1920 × 1080. Only a long note scrolls inside its
   page, and the day dialog scrolls when a day has more rows than fit.
2. **One primary action per screen.** Start focus exists only on Timer.
3. **Every label is at least 12 px** and clears 4.5:1 contrast.
4. **No explanatory paragraphs.** A heading, a label, a value. Nothing that
   explains the obvious.
5. **Reduced motion is honoured**, along with Windows High Contrast.

A fresh data file is empty — no demo sessions, notes or tasks. **Settings → Data →
Erase all data** clears every note and task while keeping your name.

## Screens

These captures are the night edition at 1440 × 900. Daybook opens in whichever
edition Windows is using; Settings → App can pin light or dark.

| Home | Timer |
|---|---|
| ![Home: a search field above two titled note cards, beside a Focus today card and a task list](docs/screenshots/home.webp) | ![Timer: a large sixty-tick dial reading 25:00, Pomodoro and Custom modes, tag chips, and one primary Start button](docs/screenshots/timer.webp) |

| Activity | Settings |
|---|---|
| ![Activity: Today, This week and Streak figures above a 30-day focus chart and a year heatmap](docs/screenshots/activity.webp) | ![Settings: four plain cards — Goals, App, Timer and Data](docs/screenshots/settings.webp) |

## Where your data lives

```
%APPDATA%\Daybook\
  daybook.json                            the live document (atomic writes)
  backups\daybook.1.json … 5.json         the last five distinct saves
  backups\pre-<version>-<timestamp>.json  a copy taken before a schema migration
  window.json                             window size, position and maximised state
```

`%APPDATA%\Daybook\` is the default. **Settings → Data → Change folder** opens a
native Windows folder picker, copies the current document and backups into an
empty folder (or uses Daybook data already there), remembers the location in
`%APPDATA%\Daybook\data-location.json`, and restarts the app.

Writes are atomic — serialise → temp file → `fsync` → rename over the target — so
a crash mid-write can never leave a half-written file. Every save rotates a
backup, and a corrupt live file is recovered from the newest readable one at
startup. **Export** and **Import** (Settings → Data) use native Windows dialogs.

### The document (schema v5)

```jsonc
{
  "version": 5,
  "createdAt": "…",                  // first launch, for the record
  "settings": { "goals": {…}, "pomodoro": {…}, "tags": [ … ], "theme": "system", … },
  "notes": [
    {
      "id": "n_…",
      "title": "Redesign notes",
      "html": "<p><strong>Ship</strong> the redesign.</p>",
      "createdAt": "…",
      "updatedAt": "…"                // advances on every save, never repeats
    }
  ],
  "days": {
    "2026-11-04": {
      "sessions": [ … ],              // focus time
      "movements": [ … ],             // retained; movement left the UI in 2.0.0
      "tasks": [ … ],                 // completion is stamped when it happens
      "note": ""                      // legacy daily note, kept for old documents
    }
  },
  "timer": { "mode": "focus", "endsAt": 1759…, "customMinutes": 30, … },
  "meta": { "launches": 12, "seeded": false, "tasksStartAt": "2026-11-04" },
  "profile": { "name": "Ada Lovelace", "createdAt": "…" },
  "onboarding": { "completed": true, "version": 1 }
}
```

- **The Home notes are `notes`.** An array of titled notes ordered by most recent
  update, with a 200-note ceiling. Titles are capped at 120 characters and HTML at
  200,000 characters on read and in the reducer.
- **Sessions** are focus time: `{ tag, startedAt, minutes, auto }`.
- **Tasks** live in the day they were written, and a completed task counts on the
  day its `doneAt` stamp says. Finishing an old task today counts today. On Home,
  open tasks from earlier days are grouped as **Remaining from earlier**.
- **`meta.tasksStartAt`** anchors the single rolling list. Open tasks from the
  retired per-day editions remain in the file, unlisted.
- **Movement** data stays in the document, but 2.0.0 has no movement controls, no
  movement chart and no movement filter. The schema keeps the field so an old
  file loses nothing.

Migrations are idempotent and each is preceded by a raw copy of the file in
`backups\pre-<version>-<timestamp>.json`. The v4 → v5 migration turns the old
single note into the first titled note, removes seeded demo sessions and tasks,
and keeps every user-created row. The v3 → v4 migration adds the note sheet
without touching sessions, movement, tasks or old daily notes. A document without
a profile name is greeted once; an existing name is never asked for again.
**Erase all data** keeps the name.

## Build from source

```powershell
npm install          # also downloads the Electron runtime (~110 MB)
npm run dev          # Vite dev server + Electron with hot reload
npm run dist         # build, then package the installer
```

Everything works from `cmd.exe` too: every script is cross-platform Node tooling.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server + Electron with hot reload |
| `npm run build` | Production build of the renderer and main/preload |
| `npm run dist` | Build, then package the NSIS installer |
| `npm test` | 319 self-tests over the reducer, storage, statistics, notes, names and timer |
| `npm run typecheck` | `tsc --noEmit` for the renderer and the main process |
| `npm run verify` | 126 acceptance checks driven against the built app over CDP |
| `npm run inspect` | Attach to a running build over CDP and evaluate expressions |
| `npm run assets` | Regenerate icons, copy fonts, and keep the archived source plates optimised |

The asset step runs automatically before `dev` and `build`. Fraunces is copied
from `@fontsource-variable/fraunces` into `src/assets/fonts` and declared in
`src/styles/fonts.css`; nothing is fetched at runtime.

## Release assets

Each release is tagged `v<major>.<minor>.<patch>`. Since 2.0.0 it carries exactly
one Windows x64 executable:

| Tag | Asset | Built by |
|---|---|---|
| `v2.2.0` | `Daybook-Setup-2.2.0.exe` | `npm run dist` → `nsis.artifactName: Daybook-Setup-${version}.${ext}` |
| `v2.1.0` | `Daybook-Setup-2.1.0.exe` | `npm run dist` → `nsis.artifactName: Daybook-Setup-${version}.${ext}` |
| `v2.0.0` | `Daybook-Setup-2.0.0.exe` | `npm run dist` → `nsis.artifactName: Daybook-Setup-${version}.${ext}` |

The version lives in `package.json` and is read back at runtime for the one line
in Settings that shows it. `release/` is git-ignored: builds are published as
release assets, never committed.

The 1.4.0 source commit was never published as a GitHub release. **v2.0.0** is the
next release after v1.3.0 and the release that fixes that gap. The portable target
and its scripts were removed from the tree in 2.0.0; the installer is the only
build.

## Keyboard

| Keys | Action |
|---|---|
| `Ctrl+1` … `Ctrl+4` | Home · Timer · Activity · Settings |
| `Space` | Start / pause (Timer tab only, ignored while typing or in a text field) |
| `Ctrl+N` | Focus the new-task field on Home |
| `F11` | Fullscreen timer (`Esc` leaves it) |
| `Esc` | Close the open dialog, or leave fullscreen |
| `Ctrl+Alt+P` | Start / pause the timer from anywhere in Windows |

The first page is keyboard-only: type a name, press Enter. Shortcut hints live in
button tooltips, not in a list on screen.

## Architecture

```
electron\              main.ts (window, tray, shortcuts, notifications, taskbar)
                       preload.ts (typed, whitelisted bridge)
                       pomodoro.ts (the timer engine, end-timestamp based)
                       storage.ts (atomic writes, backups, migrations)
src\lib                schema, reducer, stats, tasks, date, format, name, ipc, store
src\views              Welcome, Home, Timer, Activity, Settings
src\components         NoteEditor, header, charts, heatmap, dialogs, primitives
src\assets\fonts       the bundled woff2 files
src\assets\onboarding  archived photographic plates (not imported by the app)
build\                 icon.ico + the PNG sizes electron-builder needs
scripts\               dev, build, asset pipeline, unit tests, the CDP verifier
tests\                 the assertion suite behind `npm test`
```

React 18 + TypeScript + Vite for the renderer, Tailwind for styling, Electron for
the shell, and TipTap for the note editor. No UI kit, no state library, no router,
no date library, no chart library.

The reducer is imported by both processes, so the optimistic renderer update and
the authoritative main-process write apply the same pure transformation. The
renderer is sandboxed: `contextIsolation` on, `nodeIntegration` off, one named
channel per operation, every message validated in `sanitizeAction`.

### The note editor

TipTap drives one `EditorContent` with a deliberately small schema: paragraph and
hard break, bold, italic, underline, and a `textStyle` font-size mark. The toolbar
has B / I / U and a Word-style menu from 12 to 48 px; there are no headings,
lists, colours, links or images. Titles are plain text capped at 120 characters.
The HTML is stored as the editor emits it. Saves are debounced 650 ms, can be
triggered with the Save button, and are flushed on blur and unmount; the reducer
clamps the payload at 200,000 characters.

### How the timer survives everything

A running session is an absolute end timestamp, not an accumulated tick count.
Minimise it, hide it in the tray, reload the window, or quit and reopen the app
tomorrow: on boot the main process compares `endsAt` with the wall clock and
either resumes the ticker or closes the session — crediting the scheduled length
rather than the hours of absence. The ticker only exists while a session runs, so
idle CPU is zero.

### Windows integration

- Per-user NSIS install (`asInvoker`), no admin rights, choice of directory,
  desktop + Start Menu shortcuts, and an uninstaller that leaves data alone.
- A frameless window with app-drawn caption buttons at the same 48 px height as
  the header; the top row is the drag region and the controls stay inside it.
- Tray menu (show, start/pause, reset, quit) with a live countdown tooltip.
- Taskbar: `setProgressBar` while a session runs, `flashFrame` when one ends
  behind another window, and the window title becomes `24:10 · Focus — Daybook`.
- Toast notifications when a session is logged or a break ends.
- Optional start-with-Windows and close-to-tray, both off by default.
- `prefers-reduced-motion` and Windows High Contrast are both honoured.

### Security and privacy

No remote content, no remote code, no analytics, no accounts. The packaged app
runs under a strict CSP (`default-src 'self'`, no inline scripts, no objects, no
framing) over a privileged `app://daybook` origin, all permission requests are
denied, and external links open in the default browser. What you write and track
never leaves the machine.

## Testing

```powershell
npm run typecheck   # renderer + main process
npm test            # 319 assertions, no framework: node scripts/test.mjs
npm run verify      # 126 acceptance checks against the built app
npm run verify -- --exe "release\win-unpacked\Daybook.exe"   # …and the packaged one
npm run verify -- --shots shots-verify --shot-size 1440x900  # plus a PNG per screen
```

The verifier drives several processes in turn, each pointed at a scratch data
directory (`DAYBOOK_DATA_DIR`), because "the screen never comes back" and "the file
was migrated once" are only true of a fresh start. It never reads or writes your
own `%APPDATA%\Daybook`; a copy is used for the upgrade check and its history is
counted before and after. The Welcome screen can also be reviewed by hand:

```powershell
$env:DAYBOOK_FORCE_ONBOARDING=1; npm run dev
```

The acceptance run covers: the minimal Welcome screen at 1000 × 600 and 1440 ×
900, name validation, the greeting, the shell and page bar; the note library's
title, search, Save button and on-disk persistence; task carry-over from earlier
days; both timer modes, the Space shortcut and manual sessions; the three
Activity figures, the 53 × 7 calendar and the day dialog; Settings clamps, theme
and the typed delete confirmation; every tab free of page scroll and text below
12 px at 1000 × 600, 1366 × 768 and 1920 × 1080; a clean renderer console; the
launch greeting; and a v4 document upgraded to v5 with user notes, days, sessions
and tasks preserved and seeded demo rows removed.

The verifier raises the window first. Windows reports a fully covered window as
occluded, Chromium then stops painting it, and anything that waits on a frame — a
chart measuring itself, a dialog's exit animation, a screenshot — will not finish.
`--no-raise` reproduces that state on purpose.

## Packaging and the SmartScreen warning

`npm run dist` produces one file:

```
release\Daybook-Setup-2.2.0.exe
```

It is not code-signed, so the first run shows Windows SmartScreen: click
**More info → Run anyway**. To remove that warning, sign the build with an
Authenticode certificate (electron-builder reads `CSC_LINK` and
`CSC_KEY_PASSWORD`, or a `win.signtoolOptions` block).

Auto-update is deliberately absent: an updater with no signed release and no feed
is a setting that does nothing. Add `electron-updater` back with a real publish
target when there is something to update to.

## Changelog

### 2.2.0

- **Notes became a library.** Titled notes with an explicit Save button, a card
  grid on Home, search by title or body, rename and delete.
- **Tasks carry over.** Unfinished tasks stay visible on the next day as
  **Remaining from earlier**, labelled **From yesterday** or **N days old**.
- **Choose where data lives.** Settings → Data → Change folder opens a native
  folder picker, moves the document and backups, and restarts the app.
- **No demo data.** A fresh install starts empty, and the v4 → v5 migration
  removes seeded demo rows while preserving user notes and history.
- **A launch greeting.** A short animated welcome with your name, the time of day
  and a rotating prompt; skip it with a click or any key.
- **Window controls fixed.** Caption buttons act on pointer-down, so minimise,
  maximise and close respond on the first press.
- **Schema v5.** `notes` is now an array of titled notes with a 200-note ceiling.

### 2.1.0

- New logo in the app, installer, tray and Welcome, with soft blurred marks behind
  the first page.
- Fraunces everywhere, including figures, labels, the clock and the note editor.
- Caption buttons drawn inside the 48 px header so minimise, maximise and close
  fit the window at every scale.
- Note sizes are now Word-style numbers: 12, 14, 16, 18, 20, 24, 28, 32, 36 and 48.

### 2.0.0

- **Home is a note taker.** One document-level note with bold, italic, underline
  and four text sizes, saved as HTML and restored across restarts. The Start focus
  action and the movement controls left Home; starting work now lives only on
  Timer.
- **A new shell and a new Welcome screen.** A 168 px left rail, a 48 px page bar
  and rounded paper cards replace the editorial masthead, numbered headings,
  colophons and explanatory paragraphs. The Welcome screen is a wordmark, one
  question, one field and an arrow. No photograph, seal, edition line or helper
  copy.
- **Activity, simplified.** Today, This week and Streak; one 30-day focus chart;
  one focus-only year heatmap. No filters, range switch, tag chart or insight line.
  The day dialog edits sessions and completed tasks only.
- **Portable removed.** The portable target, its scripts and its docs are gone.
  `npm run dist` produces the NSIS installer only.
- **Schema v4.** Adds `notes { html, updatedAt }` with a 200,000-character cap and
  a v3 → v4 migration. Movement remains in the data but is no longer surfaced.
- The 1.4.0 source commit was never given a GitHub release; v2.0.0 is the next
  published release after v1.3.0.

### 1.4.0

- A typographic Welcome screen with a turning seal, a moving timer clock, borrowed
  ASCII ornament and a quieter masthead. The source commit exists, but no release
  asset was published for it.

### 1.3.0

- A dusk photographic Welcome screen, sourced ASCII marks, and one type system.
  The last release built with the portable target.

### 1.2.0

- The first-run name question, schema v3 and the `profile` / `onboarding` fields.

### 1.1.0

- Four tabs, one primary action per screen, Pomodoro and Custom modes, a merged
  Activity tab, and the rolling task list.

### 1.0.0

- First release: the newspaper-styled tracker that this one simplified.

## Licence

[MIT](LICENSE) © 2026 Hirak Barman (Daybook Press).

The bundled typeface keeps its own licence: Fraunces under the SIL Open Font
License 1.1. The archived Welcome photographs are no longer imported by the app;
their sources and licences are in [CREDITS.md](CREDITS.md).

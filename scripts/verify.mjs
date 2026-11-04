/**
 * Acceptance verifier — one command, one honest report.
 *
 *   node scripts/verify.mjs
 *
 * Launches the *built* app (dist + dist-electron, i.e. exactly what the
 * installer ships), drives it over the Chrome DevTools Protocol and checks the
 * 2.0 release checklist: the one-question Welcome screen, the Home note editor
 * and its formatting, the rolling task cap, both timer modes, the simplified
 * Activity tab, Settings clamps and the erase confirmation, "one screen, no
 * scroll" at every supported window size, the v3 → v4 upgrade, and a clean
 * console.
 *
 * It restores anything it changes and never confirms a destructive dialog.
 * Node 22+ has a global WebSocket, so there are no dependencies.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PORT = Number(readFlag('--port') ?? 9333);
const KEEP_OPEN = process.argv.includes('--keep-open');
// `--no-raise` leaves the window where it is. On a desktop where it ends up
// covered, Windows reports it occluded and Chromium stops painting — useful for
// reproducing that state on purpose.
const NO_RAISE = process.argv.includes('--no-raise');
// `--shots <dir>` writes one PNG per tab (and the Welcome screen) so the result
// can be eyeballed, and `--shot-size 1920x1080` chooses the capture size
// (default 1280x720).
const SHOTS = readFlag('--shots');
const SHOT_SIZE = (readFlag('--shot-size') ?? '1280x720').split('x').map(Number);

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  const mark = ok ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m';
  console.log(`${mark} ${name}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Watchdog
 * ------------------------------------------------------------------ */

/**
 * A hard ceiling on the whole run. Every wait below is individually bounded,
 * but a wedged Chromium or a window that never paints can still leave the
 * script parked forever. This makes the verifier fail loudly instead of
 * looping, so it is safe to run unattended.
 */
// The flag is in SECONDS (`--budget 180` = three minutes). Reading it as
// milliseconds made `--budget 360` a 0.36s ceiling, which aborted every run
// before the window had even opened.
const budgetFlag = Number(readFlag('--budget'));
const BUDGET_MS = Number.isFinite(budgetFlag) && budgetFlag > 0 ? budgetFlag * 1000 : 15 * 60_000;
console.log(`\u001b[2mBudget: ${Math.round(BUDGET_MS / 1000)}s (override with --budget <seconds>)\u001b[0m\n`);
// Deliberately NOT unref'd: an unref'd timer lets Node exit 0 on an empty
// event loop, which would report success for a run that never finished.
setTimeout(() => {
  console.error(`\n\u001b[31m✗ verify exceeded its ${Math.round(BUDGET_MS / 1000)}s budget — aborting.\u001b[0m`);
  console.error('  Re-run with a larger --budget, or inspect the app log above for the last step reached.');
  try {
    child?.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  process.exit(3);
}, BUDGET_MS);

/* ------------------------------------------------------------------ *
 * Launch
 * ------------------------------------------------------------------ */

/**
 * By default this drives the development Electron over the built renderer.
 * Pass `--exe "<path>\Daybook.exe"` to drive an installed or unpacked build
 * instead — the same checks then run against exactly what ships.
 */
// The path must be absolute: on Windows the child's executable is resolved
// against the `cwd` option passed to spawn, not against our own directory.
const exeFlag = readFlag('--exe');
const exePath = exeFlag ? path.resolve(root, exeFlag) : undefined;
const packaged = Boolean(exePath);
const electronBinary = exePath ?? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(electronBinary)) {
  console.error(`${electronBinary} not found — run \`npm install\` (or fix --exe).`);
  process.exit(2);
}
if (!packaged && !fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(2);
}
if (packaged) console.log(`Verifying the packaged build: ${electronBinary}\n`);

let appLog = '';
let child = null;

// A covered or minimised window is throttled by Chromium (the app opts into
// `backgroundThrottling`), and a throttled renderer answers the checks late or
// not at all. These switches keep the driven window live without changing how
// the app behaves for the user.
const unthrottle = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  // Windows tells Chromium when a window is covered and it then stops drawing
  // frames: screenshots time out and animation/observer callbacks never run.
  '--disable-features=CalculateNativeWinOcclusion',
];

/**
 * The run drives the app through several phases, and each phase gets a process
 * of its own: "the screen never comes back" and "the file was migrated once"
 * are only true of a fresh start. Every phase points the app at a scratch data
 * directory (`DAYBOOK_DATA_DIR`), so nothing here reads or writes the owner's
 * own %APPDATA%\Daybook — the owner's file is only ever copied.
 */
const scratch = path.join(root, '.verify-data');

function scratchDir(name) {
  const dir = path.join(scratch, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The live document, as the owner's machine has it. */
const liveDataFile = path.join(process.env.APPDATA ?? '', 'Daybook', 'daybook.json');

function launch(env) {
  child = spawn(electronBinary, [...(packaged ? [] : ['.']), ...unthrottle, `--remote-debugging-port=${PORT}`], {
    cwd: packaged ? path.dirname(electronBinary) : root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DAYBOOK_VERIFY: '1', ...env },
  });
  child.stdout.on('data', (d) => (appLog += d.toString()));
  child.stderr.on('data', (d) => (appLog += d.toString()));
  return child;
}

function shutdown() {
  if (!child) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {
    /* best effort */
  }
  child = null;
}

/**
 * Close the app and wait for its debugging port to stop answering. Without the
 * wait, the next phase can attach to the instance that is still shutting down
 * and check the wrong process.
 */
async function endSession() {
  shutdown();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetchJson(`http://127.0.0.1:${PORT}/json/version`, 800);
    } catch {
      return;
    }
    await sleep(250);
  }
  console.warn('\u001b[33m[verify] the previous instance kept its debugging port open\u001b[0m');
}

process.on('exit', shutdown);

async function fetchJson(url, ms = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function attach() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === 'page' && String(t.url).startsWith('app://'));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  throw new Error('the app never exposed a page target');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    const timer = setTimeout(() => reject(new Error('websocket connect timed out')), 8000);
    socket.addEventListener('open', () => clearTimeout(timer));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    socket.addEventListener('error', () => reject(new Error('websocket error')));
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}, timeoutMs = 10_000) {
          const id = nextId++;
          return new Promise((res, rej) => {
            const t = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`${method} timed out`));
            }, timeoutMs);
            pending.set(id, { resolve: res, reject: rej, timer: t });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => socket.close(),
      }),
    );
  });
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

let cdp;

/** Evaluate an expression in the page and return its JSON value. */
async function page(expression, timeoutMs = 12_000) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression: `(${expression})`, awaitPromise: true, returnByValue: true },
    timeoutMs,
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
  const value = result.result?.value;
  if (typeof value === 'string' && /^[[{]/.test(value.trim())) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

const tab = (label) =>
  page(`(async () => {
    const strip = document.querySelector('nav[aria-label="Sections"]');
    const find = () => [...strip.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    const button = find();
    if (!button) return 'missing';
    button.click();
    const settled = await window.__wait(() => find()?.getAttribute('aria-current') === 'page');
    await new Promise((r) => setTimeout(r, 120));
    return settled ? 'ok' : 'stuck';
  })()`);

const key = (type, opts) => cdp.send('Input.dispatchKeyEvent', { type, ...opts });

/**
 * Capture the page as a PNG, or null.
 *
 * Windows tells Chromium when a window is covered and it then stops compositing,
 * so the first attempts at a real surface frame can time out; the last one takes
 * the renderer's own frame, which a covered window still has. A screenshot is a
 * review aid, not an acceptance criterion, so nothing here throws.
 */
async function capture() {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!NO_RAISE) await cdp.send('Page.bringToFront').catch(() => {});
    try {
      return await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: attempt < 2 }, 30_000);
    } catch (error) {
      console.log(`\u001b[2mretrying a screenshot: ${error.message}\u001b[0m`);
      await sleep(700);
    }
  }
  return null;
}

/** Warn, don't fail: the run's verdict is about the app, not the capture. */
function warn(message) {
  console.log(`\u001b[33m${message}\u001b[0m`);
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * One phase of the run = one process of the app
 * ------------------------------------------------------------------ */

// The instrumentation every check leans on:
//   __errors — everything the renderer logs, so a clean console is provable
//   __wait   — a bounded poll, because a fixed sleep is a guess that the
//              packaged build (a shade slower than the dev one) can outrun.
// It is installed twice on purpose: once for the fresh document the reload
// creates, once into the live document, which is also proof it took.
const INJECT = `(() => {
    window.__errors = window.__errors || [];
    if (!window.__trapped) {
      window.__trapped = true;
      window.addEventListener('error', (e) => window.__errors.push('error: ' + e.message));
      const ce = console.error;
      console.error = (...a) => { window.__errors.push('console.error: ' + a.map(String).join(' ')); ce(...a); };
      const cw = console.warn;
      console.warn = (...a) => { window.__errors.push('console.warn: ' + a.map(String).join(' ')); cw(...a); };
    }
    window.__wait = async (fn, ms = 3000) => {
      const started = Date.now();
      for (;;) {
        try { if (fn()) return true; } catch { /* not there yet */ }
        if (Date.now() - started > ms) return false;
        await new Promise((r) => setTimeout(r, 60));
      }
    };
    return true;
  })()`;

/** Boot the app against its own data directory and attach to the renderer. */
async function beginSession(env) {
  launch(env);
  cdp = await connect(await attach());
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(4500);
  await page(INJECT);
  // A covered window stops painting (Windows reports it occluded and Chromium
  // hides it from the page), which stalls animations, observers and
  // screenshots. Raise it before anything is measured.
  if (!NO_RAISE) await cdp.send('Page.bringToFront').catch(() => {});
  await sleep(600);
}

/** Read a JSON document from a scratch data directory, or null. */
function readData(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'daybook.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Count what must never be lost when a document is migrated. */
function census(data) {
  const days = Object.values(data?.days ?? {});
  return {
    days: days.length,
    sessions: days.reduce((n, d) => n + d.sessions.length, 0),
    movements: days.reduce((n, d) => n + d.movements.length, 0),
    tasks: days.reduce((n, d) => n + d.tasks.length, 0),
  };
}

try {
  /* ================================================================== *
   * Phase 1 — fresh install and the new first page.
   * ================================================================== */

  const freshDir = scratchDir('fresh');
  await beginSession({ DAYBOOK_DATA_DIR: freshDir });
  check('the harness can see the renderer (error traps + poll installed)', (await page('typeof window.__wait')) === 'function');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(450);

  const welcome = await page(`(() => {
    const layer = document.querySelector('#daybook-welcome');
    if (!layer) return { present: false };
    const heading = document.getElementById('welcome-heading');
    const field = layer.querySelector('.welcome-field');
    const input = layer.querySelector('input[aria-label="Your name"]');
    const button = layer.querySelector('button[aria-label="Continue"]');
    const strip = layer.querySelector('.drag');
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const style = (el) => getComputedStyle(el);
    const hs = heading ? style(heading) : null;
    return {
      present: true,
      heading: heading ? heading.textContent.replace(/\\s+/g, ' ').trim() : null,
      headingSize: hs ? parseFloat(hs.fontSize) : 0,
      headingWeight: hs ? hs.fontWeight : '0',
      headingFont: hs ? hs.fontFamily : '',
      headingBox: heading ? box(heading) : null,
      fieldBox: field ? box(field) : null,
      fieldRadius: field ? parseFloat(style(field).borderTopLeftRadius) : 0,
      fieldBorder: field ? style(field).borderTopColor : '',
      inputSize: input ? parseFloat(style(input).fontSize) : 0,
      inputPlaceholder: input ? input.getAttribute('placeholder') : null,
      inputLabel: input ? input.getAttribute('aria-label') : null,
      focused: document.activeElement === input,
      buttonFill: button ? style(button).backgroundColor : '',
      buttonBox: button ? box(button) : null,
      images: layer.querySelectorAll('img').length,
      seal: layer.querySelectorAll('.welcome-seal').length,
      header: Boolean(document.querySelector('header')),
      aside: Boolean(document.querySelector('aside')),
      strip: strip ? { h: Math.round(strip.getBoundingClientRect().height), right: Math.round(strip.getBoundingClientRect().right) } : null,
      drags: Boolean(document.elementFromPoint(300, 24)?.closest?.('.drag')),
      overCaption: Boolean(document.elementFromPoint(window.innerWidth - 70, 24)?.closest?.('.drag')),
      background: style(layer).backgroundColor,
      text: layer.innerText.replace(/\\s+/g, ' ').trim(),
      scrolls: layer.scrollHeight - layer.clientHeight,
      docScroll: [document.documentElement.scrollHeight - window.innerHeight, document.documentElement.scrollWidth - window.innerWidth],
      scrollables: [...layer.querySelectorAll('*')].filter((el) => {
        const s = style(el);
        const can = /(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflowX);
        return can && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
      }).length,
    };
  })()`);

  check('a fresh install opens the Welcome screen', welcome.present === true, welcome);
  check('no shell chrome is rendered behind it', welcome.present && !welcome.header && !welcome.aside, welcome);
  check('the page asks one question', welcome.heading === 'What should we call you?', welcome.heading);
  check(
    'the question is Geist, 34–58px, semibold',
    /Geist/.test(welcome.headingFont) && welcome.headingWeight === '600' && welcome.headingSize >= 34 && welcome.headingSize <= 58,
    { font: welcome.headingFont, weight: welcome.headingWeight, size: welcome.headingSize },
  );
  check('the field is labelled and deliberately empty', welcome.inputLabel === 'Your name' && welcome.inputPlaceholder === 'Your name', {
    label: welcome.inputLabel,
    placeholder: welcome.inputPlaceholder,
  });
  check('the field is a rounded, bordered box', welcome.fieldRadius >= 10 && welcome.fieldBox.w >= 380, welcome.fieldBox);
  check('the name is typed at 17px', welcome.inputSize === 17, welcome.inputSize);
  check('the accent arrow is the only action', welcome.buttonFill === 'rgb(36, 80, 216)' && welcome.buttonBox.w === 44 && welcome.buttonBox.h === 44, welcome.buttonBox);
  check('the caret is already in the field', welcome.focused === true);
  check('there is no photograph and no seal', welcome.images === 0 && welcome.seal === 0, { images: welcome.images, seal: welcome.seal });
  check('no helper copy, edition line or colophon', !/edition|ledger|no account|no network|stays on this computer|press enter|quiet daily/i.test(welcome.text), welcome.text);
  check('the first page is pinned paper', welcome.background === 'rgb(246, 244, 239)', welcome.background);
  check('the top 48px drags the window', welcome.strip?.h === 48 && welcome.drags === true, welcome.strip);
  check('the caption buttons stay clear of the drag region', welcome.overCaption === false && welcome.strip.right <= 1440 - 130, welcome);
  check('the Welcome screen never scrolls', welcome.scrolls <= 1 && welcome.docScroll[0] <= 1 && welcome.docScroll[1] <= 1 && welcome.scrollables === 0, welcome);

  if (SHOTS) {
    const dir = path.resolve(root, SHOTS);
    fs.mkdirSync(dir, { recursive: true });
    const shot = await capture();
    if (shot) fs.writeFileSync(path.join(dir, 'welcome.png'), Buffer.from(shot.data, 'base64'));
    else warn('[verify] could not capture the Welcome screen — the window is not compositing');
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const compact = await page(`(() => {
    const h = document.getElementById('welcome-heading');
    const f = document.querySelector('.welcome-field');
    const lines = h ? Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)) : 0;
    const hb = h?.getBoundingClientRect();
    const fb = f?.getBoundingClientRect();
    return {
      lines,
      inside: Boolean(hb && fb && hb.left > 0 && hb.right < innerWidth && fb.left > 0 && fb.right < innerWidth && fb.bottom < innerHeight),
      gap: hb && fb ? Math.round(fb.top - hb.bottom) : -1,
      scroll: document.documentElement.scrollHeight - innerHeight,
    };
  })()`);
  check('at 1000×600 the question stays on one or two lines', compact.lines >= 1 && compact.lines <= 2, compact);
  check('and the field fits below it without a scrollbar', compact.inside && compact.gap >= 16 && compact.scroll <= 1, compact);
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  const refused = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Your name"]');
    document.querySelector('button[aria-label="Continue"]').click();
    await new Promise((r) => setTimeout(r, 180));
    const note = document.getElementById('welcome-error');
    return {
      text: note ? note.textContent.trim() : null,
      size: note ? Math.round(parseFloat(getComputedStyle(note).fontSize)) : 0,
      focused: document.activeElement === input,
      invalid: input.getAttribute('aria-invalid'),
    };
  })()`);
  check('an empty name is refused in plain words', /^Enter a name to continue\.$/.test(refused.text ?? ''), refused.text);
  check('the error is 13px and clears 4.5:1', refused.size === 13, refused.size);
  check('the refusal keeps the caret in the field', refused.focused === true && refused.invalid === 'true', refused);

  const digits = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Your name"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Agent 47');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    document.querySelector('button[aria-label="Continue"]').click();
    await new Promise((r) => setTimeout(r, 200));
    return { text: document.getElementById('welcome-error')?.textContent.trim() ?? null, still: Boolean(document.querySelector('#daybook-welcome')) };
  })()`);
  check('a name with digits is refused too', /letters/i.test(digits.text ?? '') && digits.still, digits);

  const onboarding = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Your name"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '  Ada   Lovelace  ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const greeted = await window.__wait(() => Boolean(document.querySelector('#welcome-greeting')), 3000);
    const greeting = document.querySelector('#welcome-greeting')?.textContent.replace(/\\s+/g, ' ').trim() ?? null;
    const left = await window.__wait(() => !document.querySelector('#daybook-welcome'), 5000);
    await window.__wait(() => Boolean(document.querySelector('header h1')), 3000);
    await new Promise((r) => setTimeout(r, 300));
    return {
      greeted,
      greeting,
      left,
      aside: Boolean(document.querySelector('aside')),
      heading: document.querySelector('header h1')?.textContent.trim() ?? null,
    };
  })()`);
  check('Enter saves the name', onboarding.greeted === true, onboarding);
  check('the name is said back before the app opens', onboarding.greeting === 'Welcome, Ada Lovelace.', onboarding.greeting);
  check('the shell takes over with the owner’s name', onboarding.left && onboarding.aside && onboarding.heading === 'Today, Ada Lovelace', onboarding);

  await sleep(800);
  const fresh = readData(freshDir);
  check('the name reaches the data file', fresh?.profile?.name === 'Ada Lovelace', fresh?.profile);
  check('the document is saved at schema v4', fresh?.version === 4, fresh?.version);
  check('the note sheet is empty on day one', fresh?.notes?.html === '', fresh?.notes);

  /* ================================================================== *
   * Phase 2 — shell, notes, tasks and the home page.
   * ================================================================== */

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(350);

  const shell = await page(`(() => {
    const nav = document.querySelector('nav[aria-label="Sections"]');
    const aside = document.querySelector('aside');
    const header = document.querySelector('header');
    return {
      nav: [...(nav?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()),
      asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
      headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
      pageTitle: header?.querySelector('h1')?.textContent.trim() ?? null,
      contentHeight: Math.round(document.querySelector('main').getBoundingClientRect().height),
      viewportHeight: innerHeight,
      pageScroll: document.documentElement.scrollHeight - innerHeight,
      mainScroll: Math.max(document.querySelector('main').scrollHeight - document.querySelector('main').clientHeight, document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth),
      oldCopy: /The daily edition|Colophon|Movement|Start focus|by tag|Combined/i.test(document.body.innerText),
    };
  })()`);
  check('the rail has the four sections in order', shell.nav.join(',') === 'Home,Timer,Activity,Settings', shell.nav);
  check('the rail is a fixed sidebar, not a header strip', shell.asideWidth >= 150 && shell.asideWidth <= 190, shell.asideWidth);
  check('the page bar is 48px and the content fills the rest', shell.headerHeight === 48 && shell.contentHeight === shell.viewportHeight - 48, shell);
  check('the page bar names the owner', shell.pageTitle === 'Today, Ada Lovelace', shell.pageTitle);
  check('Home fits without a scrollbar', shell.pageScroll <= 1 && shell.mainScroll <= 1, shell);
  check('the old editorial copy is gone', shell.oldCopy === false, shell.oldCopy);

  const home = await page(`(() => {
    const notes = document.querySelector('.note-prose');
    const tools = [...document.querySelectorAll('button[aria-label^="Text size"]')].map((b) => b.getAttribute('aria-label'));
    return {
      notes: Boolean(notes),
      placeholder: notes?.querySelector('p')?.className ?? '',
      bold: Boolean(document.querySelector('button[aria-label="Bold"]')),
      italic: Boolean(document.querySelector('button[aria-label="Italic"]')),
      underline: Boolean(document.querySelector('button[aria-label="Underline"]')),
      sizes: tools,
      taskInput: Boolean(document.querySelector('input[aria-label="Add a task"]')),
      primary: document.querySelectorAll('main button.btn-primary').length,
      focus: document.querySelector('section[aria-labelledby="home-focus"] p.tab')?.textContent.trim() ?? null,
      movement: /Movement|Start focus/i.test(document.querySelector('main').innerText),
      noteScrolls: Boolean(notes && notes.scrollHeight > notes.clientHeight),
    };
  })()`);
  check('Home leads with a notes editor', home.notes === true, home);
  check('the editor has bold, italic and underline', home.bold && home.italic && home.underline, home);
  check('the editor has four text sizes', home.sizes.join(',') === 'Text size S,Text size M,Text size L,Text size XL', home.sizes);
  check('the task input is on Home', home.taskInput === true);
  check('Home has no Start focus action and no movement', home.primary === 0 && home.movement === false, home);
  check('the focus figure uses the one duration format', /^(\d+h \d{2}m|\d+m)$/.test(home.focus ?? ''), home.focus);

  // Type, select and format a note; it must be in the editor and on disk.
  const typed = await page(`(async () => {
    const prose = document.querySelector('.note-prose');
    prose.focus();
    document.execCommand('insertText', false, 'A note for today.');
    await new Promise((r) => setTimeout(r, 150));
    return prose.innerText.trim();
  })()`);
  check('typing reaches the note editor', String(typed).includes('A note for today.'), typed);

  // Select through the editor's own keymap, exactly as a person would. The
  // toolbar's chain().focus() restores ProseMirror's selection, so a DOM range
  // set from outside the editor would be discarded before the mark is applied.
  await key('rawKeyDown', { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await key('keyUp', { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await sleep(180);
  const selected = await page(`getSelection()?.toString() ?? ''`);
  check('the note can be selected for formatting', String(selected).includes('A note for today.'), selected);

  const note = await page(`(async () => {
    document.querySelector('button[aria-label="Bold"]').click();
    await new Promise((r) => setTimeout(r, 120));
    document.querySelector('button[aria-label="Text size L"]').click();
    await new Promise((r) => setTimeout(r, 900));
    return { html: document.querySelector('.note-prose').innerHTML, text: document.querySelector('.note-prose').innerText.trim() };
  })()`);
  check('bold and a larger size are applied', /<strong>/.test(note.html) && /font-size:\s*18px/.test(note.html), note.html);
  await sleep(700);
  const savedNote = readData(freshDir)?.notes?.html ?? '';
  check('the note is saved to the document', /A note for today/.test(savedNote) && /<strong>/.test(savedNote) && /font-size:\s*18px/.test(savedNote), savedNote);

  // Tasks: add, complete, then fill the list to its cap at the minimum window.
  const task = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Add a task"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Verification task');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const row = [...document.querySelectorAll('main ul li')].find((li) => li.textContent.includes('Verification task'));
    row?.querySelector('button[aria-label^="Complete"]')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      added: Boolean(row),
      stillOpen: [...document.querySelectorAll('main ul li')].some((li) => li.textContent.includes('Verification task')),
      undo: document.body.innerText.includes('Undo'),
    };
  })()`);
  check('a task can be added on Home', task.added === true, task);
  check('checking it removes it from the open list and offers Undo', task.stillOpen === false && task.undo === true, task);

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const cap = await page(`(async () => {
    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    for (let i = 0; i < 9; i++) {
      const input = document.querySelector('input[aria-label="Add a task"]');
      if (!input || input.disabled) break;
      setValue(input, 'Cap task ' + i);
      await new Promise((r) => setTimeout(r, 80));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
    }
    const input = document.querySelector('input[aria-label="Add a task"]');
    const main = document.querySelector('main');
    const list = document.querySelector('section[aria-labelledby="home-tasks"] ul');
    const result = {
      full: input.disabled,
      rows: document.querySelectorAll('section[aria-labelledby="home-tasks"] ul > li').length,
      mainOverflow: Math.max(main.scrollHeight - main.clientHeight, main.scrollWidth - main.clientWidth),
      listOverflow: list ? Math.max(list.scrollHeight - list.clientHeight, list.scrollWidth - list.clientWidth) : 0,
    };
    [...document.querySelectorAll('button[aria-label^="Delete Cap task"]')].forEach((b) => b.click());
    await new Promise((r) => setTimeout(r, 250));
    result.cleaned = document.querySelectorAll('button[aria-label^="Delete Cap task"]').length;
    return result;
  })()`);
  check('the task list stops at its seven-item cap', cap.full === true && cap.rows <= 7, cap);
  check('a full task list still fits the smallest window', cap.mainOverflow <= 1 && cap.listOverflow <= 1, cap);
  check('the verification tasks are cleaned up', cap.cleaned === 0, cap);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(250);

  // The note survives leaving and returning to Home.
  await tab('Timer');
  await tab('Home');
  const noteBack = await page(`document.querySelector('.note-prose')?.innerText.trim() ?? ''`);
  check('the note survives a tab switch', String(noteBack).includes('A note for today.'), noteBack);

  /* ================================================================== *
   * Phase 3 — the timer, still the one place to start focus.
   * ================================================================== */

  await tab('Timer');
  await page(`(async () => {
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Pomodoro')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  })()`);
  const timerIdle = await page(`(() => {
    const primary = document.querySelector('main button.btn-primary');
    const seg = [...document.querySelectorAll('.seg button')].map((b) => b.textContent.trim());
    return {
      seg,
      primary: primary?.textContent.trim(),
      ticks: document.querySelectorAll('svg[aria-label*="remaining"] line').length,
      dots: document.querySelectorAll('main [aria-hidden="true"] span.h-2').length,
      editLink: /—\\s*Edit/.test(document.body.innerText),
      tags: document.querySelectorAll('[role="group"][aria-label="Focus tag"] .chip').length,
      manual: document.body.innerText.includes('Add session'),
      footer: /Today .* · \\d+ session/.test(document.body.innerText),
    };
  })()`);
  check('Timer offers Pomodoro and Custom', timerIdle.seg.join(',') === 'Pomodoro,Custom', timerIdle.seg);
  check('Timer leads with Start', timerIdle.primary === 'Start', timerIdle.primary);
  check('the dial still draws sixty ticks and four round dots', timerIdle.ticks === 60 && timerIdle.dots === 4, timerIdle);
  check('the tag chips are on the timer screen', timerIdle.tags >= 1, timerIdle);
  check('the old edit-lengths link and copy are gone', timerIdle.editLink === false, timerIdle);
  check('today’s figures and a manual session remain', timerIdle.footer && timerIdle.manual, timerIdle);

  const running = await page(`(async () => {
    const label = () => document.querySelector('main button.btn-primary')?.textContent.trim();
    document.querySelector('main button.btn-primary').click();
    const started = await window.__wait(() => label() === 'Pause', 3000);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const paused = await window.__wait(() => label() === 'Start', 3000);
    return { started, paused };
  })()`);
  check('Start begins the session', running.started === true, running);
  check('Space pauses it again', running.paused === true, running);

  const custom = await page(`(async () => {
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Custom').click();
    await new Promise((r) => setTimeout(r, 250));
    const presets = [...document.querySelectorAll('main .chip')].map((c) => c.textContent.trim()).filter((t) => /^\\d+ min$/.test(t));
    const field = document.querySelector('input[aria-label="Timer length, hours and minutes"]');
    return { presets, field: field?.value, skip: document.body.innerText.includes('Skip') };
  })()`);
  check('Custom mode has its five presets and an HH:MM field', custom.presets.join(',') === '15 min,30 min,45 min,60 min,90 min' && /^\d{2}:\d{2}$/.test(custom.field ?? ''), custom);
  check('Custom mode has no Skip control', custom.skip === false, custom);
  await page(`(async () => {
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Pomodoro')?.click();
    await new Promise((r) => setTimeout(r, 250));
    document.querySelector('main button.btn-primary')?.click();
    await new Promise((r) => setTimeout(r, 250));
    [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Reset')?.click();
    await new Promise((r) => setTimeout(r, 200));
    return true;
  })()`);

  /* ================================================================== *
   * Phase 4 — Activity, reduced to one measure.
   * ================================================================== */

  await tab('Activity');
  const activity = await page(`(() => {
    const cells = document.querySelectorAll('.heat-cell[data-cell]');
    return {
      figures: [...document.querySelectorAll('main .card .label')].map((el) => el.textContent.trim()).slice(0, 3),
      cells: cells.length,
      columns: new Set([...cells].map((c) => c.dataset.col)).size,
      chart: Boolean(document.querySelector('svg[aria-label*="last 30 days"]')),
      controls: document.querySelectorAll('main .seg button').length,
      tagChart: /By tag|Other|No tag/i.test(document.querySelector('main').innerText),
      insight: /You focus best/i.test(document.body.innerText),
    };
  })()`);
  check('Activity shows exactly three focus figures', activity.figures.join(',') === 'Today,This week,Streak', activity.figures);
  check('the year calendar is still 53 × 7', activity.cells === 371 && activity.columns === 53, activity);
  check('the 30-day chart is on screen', activity.chart === true);
  check('the old filters, tag chart and insight line are gone', activity.controls === 0 && activity.tagChart === false && activity.insight === false, activity);

  const dayDialog = await page(`(async () => {
    const today = [...document.querySelectorAll('.heat-cell[data-cell]')].find((c) => c.dataset.today === 'true');
    today?.click();
    const opened = await window.__wait(() => Boolean(document.querySelector('[role="dialog"]')), 2000);
    const dialog = document.querySelector('[role="dialog"]');
    return {
      opened,
      title: dialog?.querySelector('h2')?.textContent.trim() ?? null,
      focus: dialog?.innerText.includes('Focus sessions') ?? false,
      tasks: dialog?.innerText.includes('Tasks done') ?? false,
      movement: dialog?.innerText.includes('Movement') ?? false,
      addSession: dialog?.innerText.includes('Add session') ?? false,
    };
  })()`);
  check('a day opens in the detail dialog', dayDialog.opened === true, dayDialog);
  check('the dialog edits sessions and completed tasks only', dayDialog.focus && dayDialog.tasks && dayDialog.movement === false && dayDialog.addSession, dayDialog);
  await page(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    return !document.querySelector('[role="dialog"]');
  })()`);

  /* ================================================================== *
   * Phase 5 — Settings, four cards and no prose.
   * ================================================================== */

  await tab('Settings');
  const settings = await page(`(() => {
    const text = document.querySelector('main').innerText;
    return {
      cards: [...document.querySelectorAll('main section h2')].map((h) => h.textContent.trim()),
      numbered: /\\b0[1-9]\\b/.test(text),
      name: Boolean(document.querySelector('main input[aria-label="Your name"]')),
      theme: [...document.querySelectorAll('main .seg button')].map((b) => b.textContent.trim()),
      prose: /These three numbers|Every change|Everything is stored|Changes apply|A running session|One JSON file|Export writes/i.test(text),
      erase: text.includes('Erase all data'),
    };
  })()`);
  check('Settings is four plain cards', settings.cards.join(',') === 'Goals,App,Timer,Data', settings.cards);
  check('the numbered headings and explanatory copy are gone', settings.numbered === false && settings.prose === false, settings);
  check('the name and theme controls remain', settings.name && settings.theme.join(',') === 'Auto,Light,Dark', settings);
  check('there is one destructive action', settings.erase === true);

  const renamed = await page(`(async () => {
    const field = document.querySelector('main input[aria-label="Your name"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, 'Ada King');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    field.focus();
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));
    return field.value;
  })()`);
  await tab('Home');
  await sleep(250);
  const renamedTitle = await page(`document.querySelector('header h1')?.textContent.trim() ?? null`);
  check('changing the name updates the page bar', renamed === 'Ada King' && renamedTitle === 'Today, Ada King', { renamed, renamedTitle });
  await tab('Settings');

  const clamp = await page(`(async () => {
    const field = document.querySelector('main input[aria-label="Focus in min"]');
    const original = field.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, '9999');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    field.focus();
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    const clamped = document.querySelector('main input[aria-label="Focus in min"]').value;
    const restore = document.querySelector('main input[aria-label="Focus in min"]');
    setter.call(restore, original);
    restore.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    restore.focus();
    restore.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { original, clamped, restored: document.querySelector('main input[aria-label="Focus in min"]').value };
  })()`);
  check('an out-of-range goal is clamped on blur', clamp.clamped === '720', clamp);
  check('the test restores the owner’s goal', clamp.restored === clamp.original, clamp);

  const theme = await page(`(async () => {
    const wasDark = document.documentElement.classList.contains('dark');
    [...document.querySelectorAll('main .seg button')].find((b) => b.textContent.trim() === 'Dark')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const dark = document.documentElement.classList.contains('dark');
    [...document.querySelectorAll('main .seg button')].find((b) => b.textContent.trim() === 'Auto')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return { wasDark, dark, after: document.documentElement.classList.contains('dark') };
  })()`);
  check('Dark repaints the app', theme.dark === true, theme);
  check('Auto returns to the Windows setting', theme.after === theme.wasDark, theme);

  const erase = await page(`(async () => {
    [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('Erase all data'))?.click();
    await new Promise((r) => setTimeout(r, 300));
    const dialog = document.querySelector('[role="dialog"]');
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('Erase everything'));
    const required = dialog?.innerText.includes('Type DELETE') ?? false;
    const disabled = confirm?.disabled ?? true;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    return { required, disabled, closed: !document.querySelector('[role="dialog"]') };
  })()`);
  check('erasing requires a typed confirmation', erase.required && erase.disabled, erase);
  check('cancelling closes the dialog untouched', erase.closed === true, erase);

  /* ================================================================== *
   * Phase 6 — every tab fits at every supported size.
   * ================================================================== */

  const sizes = [
    [1000, 600],
    [1366, 768],
    [1920, 1080],
  ];
  for (const [width, height] of sizes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const label of ['Home', 'Timer', 'Activity', 'Settings']) {
      await tab(label);
      await sleep(220);
      const fit = await page(`(() => {
        const main = document.querySelector('main');
        const tiny = [...document.querySelectorAll('main *')].filter((el) => {
          if (el.closest('[data-ornament]') || el.closest('.sr-only') || el.closest('[aria-hidden="true"]')) return false;
          if (el.childElementCount > 0) return false;
          if (!el.textContent.trim()) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return false;
          return parseFloat(getComputedStyle(el).fontSize) < 12;
        }).map((el) => ({ tag: el.tagName, text: el.textContent.trim().slice(0, 30), size: parseFloat(getComputedStyle(el).fontSize) }));
        return {
          page: Math.max(document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth),
          main: Math.max(main.scrollHeight - main.clientHeight, main.scrollWidth - main.clientWidth),
          tiny,
        };
      })()`);
      check(`${label} fits ${width}×${height}`, fit.page <= 1 && fit.main <= 1, fit);
      check(`${label} keeps every label at 12px or more at ${width}×${height}`, fit.tiny.length === 0, fit.tiny);
    }
  }

  /* --------------------------------------------------------- screenshots */
  if (SHOTS) {
    const dir = path.resolve(root, SHOTS);
    fs.mkdirSync(dir, { recursive: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: SHOT_SIZE[0] ?? 1440,
      height: SHOT_SIZE[1] ?? 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const label of ['Home', 'Timer', 'Activity', 'Settings']) {
      await tab(label);
      await sleep(450);
      const shot = await capture();
      if (!shot) {
        warn(`[verify] could not capture ${label}`);
        continue;
      }
      fs.writeFileSync(path.join(dir, `${label.toLowerCase()}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`\\u001b[2m${label} screenshot → ${path.relative(root, path.join(dir, `${label.toLowerCase()}.png`))}\\u001b[0m`);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  }

  const tidy = await page(`(async () => {
    [...document.querySelectorAll('nav[aria-label="Sections"] button')].find((b) => b.textContent.trim() === 'Timer')?.click();
    await new Promise((r) => setTimeout(r, 250));
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Pomodoro')?.click();
    await new Promise((r) => setTimeout(r, 250));
    [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Reset')?.click();
    await new Promise((r) => setTimeout(r, 250));
    return document.querySelector('main button.btn-primary')?.textContent.trim() ?? null;
  })()`);
  check('the run leaves the timer stopped and tidy', tidy === 'Start', tidy);

  const errors = await page('JSON.stringify(window.__errors || [])');
  check('the renderer logged no errors or warnings', Array.isArray(errors) && errors.length === 0, errors);

  await endSession();

  /* ================================================================== *
   * Phase 7 — an upgrade keeps every day and does not invent a name.
   * ================================================================== */

  const upgradeDir = scratchDir('upgrade');
  const hasLiveFile = fs.existsSync(liveDataFile);
  check('the owner’s own document is available to upgrade', hasLiveFile, liveDataFile);
  let beforeUpgrade = null;
  let seedText = '';
  if (hasLiveFile) {
    // Simulate a 1.x document: schema v3, no note sheet, no saved name. The
    // history is the owner's real history, so a migration that drops a day or a
    // task is caught against real data rather than a fixture.
    beforeUpgrade = JSON.parse(fs.readFileSync(liveDataFile, 'utf8'));
    beforeUpgrade.version = 3;
    delete beforeUpgrade.notes;
    delete beforeUpgrade.profile;
    seedText = JSON.stringify(beforeUpgrade);
    fs.writeFileSync(path.join(upgradeDir, 'daybook.json'), seedText);
  }

  await beginSession({ DAYBOOK_DATA_DIR: upgradeDir });
  check('an upgrading owner is greeted once', (await page('Boolean(document.querySelector("#daybook-welcome"))')) === true);
  const copies = hasLiveFile
    ? fs.readdirSync(path.join(upgradeDir, 'backups')).filter((f) => f.startsWith('pre-'))
    : [];
  check(
    'the pre-migration copy is taken before the file is rewritten',
    hasLiveFile && copies.length === 1 && fs.readFileSync(path.join(upgradeDir, 'backups', copies[0]), 'utf8') === seedText,
    copies,
  );

  const upgraded = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Your name"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Grace Hopper-Wells');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const left = await window.__wait(() => !document.querySelector('#daybook-welcome'), 5000);
    await new Promise((r) => setTimeout(r, 600));
    return { left, heading: document.querySelector('header h1')?.textContent.trim() ?? null };
  })()`);
  check('the upgrade is greeted and handed to Home', upgraded.left && upgraded.heading === 'Today, Grace Hopper-Wells', upgraded);

  const afterUpgrade = readData(upgradeDir);
  check(
    'nothing in the existing document was lost',
    JSON.stringify(census(afterUpgrade)) === JSON.stringify(census(beforeUpgrade)),
    { before: census(beforeUpgrade), after: census(afterUpgrade) },
  );
  check('the upgrade gains a note sheet without touching old data', typeof afterUpgrade?.notes?.html === 'string', afterUpgrade?.notes);

  await endSession();
  await beginSession({ DAYBOOK_DATA_DIR: upgradeDir });
  const settled = await page(`(async () => {
    await new Promise((r) => setTimeout(r, 1200));
    return {
      welcome: Boolean(document.querySelector('#daybook-welcome')),
      aside: Boolean(document.querySelector('aside')),
      heading: document.querySelector('header h1')?.textContent.trim() ?? null,
    };
  })()`);
  check('a saved name means the Welcome screen never comes back', settled.welcome === false && settled.aside, settled);
  check('the second launch opens Home under that name', settled.heading === 'Today, Grace Hopper-Wells', settled);

  await endSession();

  /* ================================================================== *
   * Phase 8 — forced onboarding remains available for review.
   * ================================================================== */

  await beginSession({ DAYBOOK_DATA_DIR: upgradeDir, DAYBOOK_FORCE_ONBOARDING: '1' });
  const forced = await page(`(async () => {
    await new Promise((r) => setTimeout(r, 700));
    return {
      welcome: Boolean(document.querySelector('#daybook-welcome')),
      heading: document.getElementById('welcome-heading')?.textContent.trim() ?? null,
    };
  })()`);
  check('DAYBOOK_FORCE_ONBOARDING=1 brings the screen back', forced.welcome === true && forced.heading === 'What should we call you?', forced);
  if (!KEEP_OPEN) await endSession();

  /* ------------------------------------------------------ the bundle */
  const assetDir = path.join(root, 'dist', 'assets');
  const shipped = fs.existsSync(assetDir) ? fs.readdirSync(assetDir) : [];
  check('the installer ships no photograph at all', !shipped.some((f) => /\\.(webp|avif|png|jpe?g)$/i.test(f)), shipped);

  /* ---------------------------------------------------------- report */
  const failed = results.filter((r) => !r.ok);
  console.log(`\\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\\nFailures:');
    for (const f of failed) console.log(`  • ${f.name}${f.detail === undefined ? '' : ` — ${JSON.stringify(f.detail)}`}`);
    if (appLog.trim()) console.log(`\\nApp log:\\n${appLog.trim().split('\\n').slice(-30).join('\\n')}`);
  }
  if (KEEP_OPEN) console.log('\\n--keep-open: the app is still running.');
  else shutdown();
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error(`\\nverify failed: ${error.message}`);
  if (appLog.trim()) console.error(`\\nApp log:\\n${appLog.trim().split('\\n').slice(-35).join('\\n')}`);
  shutdown();
  process.exit(2);
}

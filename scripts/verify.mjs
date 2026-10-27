/**
 * Acceptance verifier — one command, one honest report.
 *
 *   node scripts/verify.mjs
 *
 * Launches the *built* app (dist + dist-electron, i.e. exactly what the
 * installer ships), drives it over the Chrome DevTools Protocol and checks the
 * release checklist: four tabs, "one screen, no scroll" at every supported
 * window size and display scaling, the rolling task cap, both timer modes,
 * the heatmap and its day dialog, the charts, Settings autosave and clamps, the
 * erase confirmation, and a clean console.
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
// `--shots <dir>` writes one PNG per tab so the result can be eyeballed, and
// `--shot-size 1920x1080` chooses the capture size (default 1280x720).
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
   * Phase 1 — a fresh install: the Welcome screen, in full.
   * ================================================================== */

  const freshDir = scratchDir('fresh');
  await beginSession({ DAYBOOK_DATA_DIR: freshDir });
  check('the harness can see the renderer (error traps + poll installed)', (await page('typeof window.__wait')) === 'function');

  // Printed, not asserted: whether the window is drawing frames decides how
  // every later interaction behaves, and that is the environment's business.
  const liveness = await page(
    `(async () => {
      const before = {
        visibility: document.visibilityState,
        focus: document.hasFocus(),
        viewport: window.innerWidth + 'x' + window.innerHeight,
      };
      const frames = await Promise.race([
        new Promise((r) => requestAnimationFrame(() => r(true))),
        new Promise((r) => setTimeout(() => r(false), 2000)),
      ]);
      return { ...before, frames };
    })()`,
    20_000,
  );
  console.log(`\u001b[2mrenderer: ${JSON.stringify(liveness)}\u001b[0m`);

  /* ------------------------------------------------------- welcome */
  // The reference canvas from the brief. Every dimension below is measured at
  // 1536×1024, then again at the 1000×600 minimum where the heading and the
  // field are closest together.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 1024, deviceScaleFactor: 1, mobile: false });
  await sleep(500);

  const welcome = await page(`(() => {
    const layer = document.querySelector('#daybook-welcome');
    // Every field is present even when the screen is not, so a missing screen
    // reports itself as a list of failures rather than crashing the run.
    if (!layer) return {
      present: false, viewport: [window.innerWidth, window.innerHeight], header: true, tabs: true,
      headingText: null, headingColors: [], headingSize: 0, headingWeight: '0', headingFont: '',
      headingWrap: '', headingLines: 0, headingEdges: false,
      headingBox: { w: 0, h: 0, cx: -999, cy: -999, right: -999 },
      pillBox: { w: 0, h: 0, cx: -999, cy: -999, right: -999 },
      pillRadius: 0, pillBorderWidth: 0, pillBorderColor: '', pillFill: '', pillBlur: 'none', dpr: 1,
      inputFont: '', inputSize: 0, inputPad: 0, inputCaret: '', inputPlaceholder: null, inputLabel: null,
      focused: false, buttonBox: { w: 0, h: 0, cx: -999, cy: -999, right: -999 }, buttonFill: '',
      buttonRadius: 0, arrow: null, image: null, strip: null, drags: false, overCaption: null,
      scrolls: 0, docScroll: [0, 0], scrollables: 0,
    };
    const round = (n) => Math.round(n * 100) / 100;
    const style = (el) => getComputedStyle(el);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height), right: round(r.right), cx: round(r.x + r.width / 2), cy: round(r.y + r.height / 2) };
    };
    const heading = document.getElementById('welcome-heading');
    const input = layer.querySelector('input[aria-label="Your name"]');
    const button = layer.querySelector('button[aria-label="Continue"]');
    const pill = layer.querySelector('.welcome-pill');
    const image = layer.querySelector('img');
    const strip = layer.querySelector('.drag');
    const svg = button ? button.querySelector('svg') : null;
    const headingStyle = heading ? style(heading) : null;
    return {
      present: true,
      viewport: [window.innerWidth, window.innerHeight],
      header: Boolean(document.querySelector('header')),
      tabs: Boolean(document.querySelector('nav[aria-label="Sections"]')),
      headingText: heading ? heading.textContent.replace(/\\s+/g, ' ').trim() : null,
      headingColors: [...heading.querySelectorAll('span')].map((s) => style(s).color),
      headingBox: box(heading),
      headingSize: round(parseFloat(headingStyle.fontSize)),
      headingWeight: headingStyle.fontWeight,
      headingFont: headingStyle.fontFamily,
      headingWrap: headingStyle.textWrap,
      headingLines: Math.round(heading.getBoundingClientRect().height / parseFloat(headingStyle.lineHeight)),
      headingEdges:
        heading.getBoundingClientRect().left > 0 && heading.getBoundingClientRect().right < window.innerWidth,
      pillBox: box(pill),
      pillRadius: round(parseFloat(style(pill).borderTopLeftRadius)),
      pillBorderWidth: round(parseFloat(style(pill).borderTopWidth)),
      pillBorderColor: style(pill).borderTopColor,
      pillFill: style(pill).backgroundColor,
      pillBlur: style(pill).backdropFilter,
      dpr: window.devicePixelRatio,
      inputFont: style(input).fontFamily,
      inputSize: round(parseFloat(style(input).fontSize)),
      inputPad: round(parseFloat(style(input).paddingLeft)),
      inputCaret: style(input).caretColor,
      inputPlaceholder: input.getAttribute('placeholder'),
      inputLabel: input.getAttribute('aria-label'),
      focused: document.activeElement === input,
      buttonBox: box(button),
      buttonFill: style(button).backgroundColor,
      buttonRadius: round(parseFloat(style(button).borderTopLeftRadius)),
      arrow: svg
        ? { size: round(svg.getBoundingClientRect().width), stroke: svg.getAttribute('stroke-width') }
        : null,
      image: image
        ? {
            src: String(image.currentSrc || image.src).split('/').pop(),
            fit: style(image).objectFit,
            position: style(image).objectPosition,
            loaded: image.naturalWidth > 0,
          }
        : null,
      strip: strip ? { h: round(strip.getBoundingClientRect().height), right: round(strip.getBoundingClientRect().right) } : null,
      drags: (() => {
        const el = document.elementFromPoint(300, 24);
        return Boolean(el && (el.closest('.drag') || String(el.className || '').includes('drag')));
      })(),
      overCaption: (() => {
        const el = document.elementFromPoint(window.innerWidth - 70, 24);
        return el ? Boolean(el.closest && el.closest('.drag')) : null;
      })(),
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
  check('the header and the four tabs are hidden while it is up', welcome.present && !welcome.header && !welcome.tabs, welcome);
  check(
    'the heading is the two-tone line from the mockup',
    welcome.headingText === 'What shall we call you, Knight?' && welcome.headingColors.length === 2,
    { text: welcome.headingText, colors: welcome.headingColors },
  );
  check(
    'cream first, then the word “Knight?” in the accent',
    welcome.headingColors[0] === 'rgb(244, 239, 230)' && welcome.headingColors[1] === 'rgb(244, 88, 58)',
    welcome.headingColors,
  );
  check(
    'the heading is Fraunces at regular weight, 28–44px',
    /Fraunces/.test(welcome.headingFont) && welcome.headingWeight === '400' && welcome.headingSize >= 28 && welcome.headingSize <= 44,
    { font: welcome.headingFont, weight: welcome.headingWeight, size: welcome.headingSize },
  );
  check('the heading is centred, with room to balance', welcome.headingWrap === 'balance' && welcome.headingEdges, welcome.headingWrap);
  check(
    'the heading’s middle sits on the 50% line',
    Math.abs(welcome.headingBox.cx - welcome.viewport[0] / 2) <= 2 &&
      Math.abs(welcome.headingBox.cy - welcome.viewport[1] / 2) <= welcome.viewport[1] * 0.02,
    welcome.headingBox,
  );
  check(
    'the field’s middle sits on the 58% line',
    Math.abs(welcome.pillBox.cx - welcome.viewport[0] / 2) <= 2 &&
      Math.abs(welcome.pillBox.cy - welcome.viewport[1] * 0.58) <= welcome.viewport[1] * 0.02,
    welcome.pillBox,
  );
  check(
    'the field is a 64–70px pill, 340–560px wide, 16–18px corners',
    welcome.pillBox.h >= 64 && welcome.pillBox.h <= 70 &&
      welcome.pillBox.w >= 340 && welcome.pillBox.w <= 560 &&
      welcome.pillRadius >= 16 && welcome.pillRadius <= 18,
    welcome.pillBox,
  );
  // Painted widths cannot be asserted on a scaled display: Chromium snaps every
  // border to whole device pixels and reports that used value, so the authored
  // 1.5px arrives here as 0.8px (one device pixel) at 125% scaling. The rule
  // says what was asked for; the painted box says it made it to the screen.
  const borderRule = await page(`(() => {
    const pill = document.querySelector('.welcome-pill');
    const authored = pill ? [...pill.classList].filter((c) => c.indexOf('1.5px') > -1) : [];
    const widths = [];
    for (const sheet of document.styleSheets) {
      let rules = [];
      try { rules = [...sheet.cssRules]; } catch (e) { continue; }
      for (const entry of rules) {
        const width = entry.style && entry.style.borderWidth;
        if (width && widths.indexOf(width) === -1) widths.push(width);
      }
    }
    return { authored, widths };
  })()`);
  check(
    'the field is near-black on a 1.5px accent border, with a backdrop blur',
    welcome.pillFill === 'rgba(10, 8, 7, 0.88)' &&
      welcome.pillBorderColor === 'rgb(244, 88, 58)' &&
      welcome.pillBorderWidth > 0.5 &&
      welcome.pillBlur !== 'none' &&
      borderRule.authored.length === 1 &&
      borderRule.widths.indexOf('1.5px') > -1,
    {
      fill: welcome.pillFill,
      painted: `${welcome.pillBorderWidth}px ${welcome.pillBorderColor}`,
      blur: welcome.pillBlur,
      authored: borderRule,
    },
  );
  check(
    'the field takes 20px text on a 24px inset',
    welcome.inputSize === 20 && welcome.inputPad === 24 && /Geist/.test(welcome.inputFont),
    { size: welcome.inputSize, pad: welcome.inputPad, font: welcome.inputFont },
  );
  check('the caret is the accent colour', welcome.inputCaret === 'rgb(244, 88, 58)', welcome.inputCaret);
  check(
    'the field is labelled and deliberately empty',
    welcome.inputLabel === 'Your name' && welcome.inputPlaceholder === null,
    { label: welcome.inputLabel, placeholder: welcome.inputPlaceholder },
  );
  check('the caret is already in the field', welcome.focused === true);
  check(
    'the arrow is a 48px circle inside the right end of the field',
    welcome.buttonBox.w === 48 && welcome.buttonBox.h === 48 &&
      Math.abs(welcome.buttonBox.cy - welcome.pillBox.cy) <= 1.5 &&
      welcome.pillBox.right - welcome.buttonBox.right >= 9 && welcome.pillBox.right - welcome.buttonBox.right <= 12 &&
      welcome.buttonFill === 'rgb(244, 88, 58)' && welcome.buttonRadius >= 23,
    { button: welcome.buttonBox, pill: welcome.pillBox, fill: welcome.buttonFill, radius: welcome.buttonRadius },
  );
  check(
    'the arrow is an inline 22px glyph with a 2px stroke',
    welcome.arrow !== null && Math.round(welcome.arrow.size) === 22 && welcome.arrow.stroke === '2',
    welcome.arrow,
  );
  check(
    'the background is the bundled WebP, cover, held at 50% 40%',
    welcome.image !== null && /\.webp$/.test(welcome.image.src) && welcome.image.fit === 'cover' &&
      welcome.image.position === '50% 40%' && welcome.image.loaded,
    welcome.image,
  );
  check(
    'the Welcome screen never scrolls',
    welcome.scrolls <= 1 && welcome.docScroll[0] <= 1 && welcome.docScroll[1] <= 1 && welcome.scrollables === 0,
    { layer: welcome.scrolls, page: welcome.docScroll, scrollables: welcome.scrollables },
  );
  check('the top 48px drags the window', welcome.strip !== null && welcome.strip.h === 48 && welcome.drags === true, welcome.strip);
  check(
    'the caption buttons stay clear of the drag region',
    welcome.overCaption === false && welcome.strip.right <= welcome.viewport[0] - 130,
    { overCaption: welcome.overCaption, strip: welcome.strip, viewport: welcome.viewport },
  );
  console.log(`\u001b[2mwelcome: heading ${welcome.headingBox.w}×${welcome.headingBox.h}, field ${welcome.pillBox.w}×${welcome.pillBox.h}\u001b[0m`);

  // Captured here, while the screen is still up and still empty — this is the
  // first thing a new owner ever sees.
  if (SHOTS) {
    const dir = path.resolve(root, SHOTS);
    fs.mkdirSync(dir, { recursive: true });
    const shot = await capture();
    if (shot) fs.writeFileSync(path.join(dir, 'welcome.png'), Buffer.from(shot.data, 'base64'));
    else warn('[verify] could not capture the Welcome screen — the window is not compositing');
  }

  /* --------------------------------------------------- the refusals */
  const empty = await page(`(async () => {
    const layer = document.querySelector('#daybook-welcome');
    const input = layer.querySelector('input[aria-label="Your name"]');
    const pill = layer.querySelector('.welcome-pill').parentElement;
    if (!layer) return { noteText: null, noteSize: 0, focused: false, invalid: null, described: null, moved: 0, reduced: false };
    document.querySelector('button[aria-label="Continue"]').click();
    // Watch the field for the shake while the helper line appears.
    const moved = [];
    const until = Date.now() + 800;
    while (Date.now() < until) {
      const matrix = /matrix\\(([^)]+)\\)/.exec(getComputedStyle(pill).transform);
      if (matrix) {
        const x = Math.round(parseFloat(matrix[1].split(',')[4]) * 10) / 10;
        if (Math.abs(x) > 0.5 && moved.indexOf(x) === -1) moved.push(x);
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    const note = document.getElementById('welcome-error');
    return {
      noteText: note ? note.textContent.trim() : null,
      noteSize: note ? Math.round(parseFloat(getComputedStyle(note).fontSize)) : 0,
      focused: document.activeElement === input,
      invalid: input.getAttribute('aria-invalid'),
      described: input.getAttribute('aria-describedby'),
      moved: moved.length,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  })()`);
  check('an empty name is refused in plain words', /^Enter a name to continue\.$/.test(empty.noteText ?? ''), empty.noteText);
  check('the helper line is 13px', empty.noteSize === 13, empty.noteSize);
  check('the refusal keeps the caret in the field', empty.focused === true && empty.invalid === 'true', empty);
  check(
    'and shakes the field — skipped under reduced motion',
    empty.reduced ? empty.moved === 0 : empty.moved > 0,
    { reduced: empty.reduced, positions: empty.moved },
  );

  // The helper line sits over the photograph, so its contrast is measured
  // against the photo's own pixels (the vignette only darkens them, which makes
  // this the conservative reading).
  const contrast = await page(`(() => {
    try {
      const note = document.getElementById('welcome-error');
      const image = document.querySelector('#daybook-welcome img');
      if (!note || !image || !image.naturalWidth) return { error: 'no note or no image' };
      const box = note.getBoundingClientRect();
      const W = window.innerWidth, H = window.innerHeight;
      const iw = image.naturalWidth, ih = image.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      const ox = (W - iw * scale) * 0.5, oy = (H - ih * scale) * 0.4;
      const pad = 6;
      const sx = Math.max(0, (box.left - pad - ox) / scale);
      const sy = Math.max(0, (box.top - pad - oy) / scale);
      const sw = Math.max(1, Math.min(iw - sx, (box.width + pad * 2) / scale));
      const sh = Math.max(1, Math.min(ih - sy, (box.height + pad * 2) / scale));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var brightest = [0, 0, 0], best = -1;
      for (var i = 0; i < data.length; i += 4) {
        var L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (L > best) { best = L; brightest = [data[i], data[i + 1], data[i + 2]]; }
      }
      var lin = function (v) { var c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      var rel = function (rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); };
      var parts = String(getComputedStyle(note).color).replace(/[^0-9.]/g, ' ').trim().split(/ +/).map(Number);
      var alpha = parts.length > 3 ? parts[3] : 1;
      var over = [0, 1, 2].map(function (k) { return parts[k] * alpha + brightest[k] * (1 - alpha); });
      var a = rel(over), b = rel(brightest);
      return {
        ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
        behind: brightest,
        text: over.map(Math.round),
      };
    } catch (err) {
      return { error: String(err.message) };
    }
  })()`);
  check(
    'the helper line clears 4.5:1 over the photograph',
    typeof contrast.ratio === 'number' && contrast.ratio >= 4.5,
    contrast,
  );

  const letters = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Your name"]');
    if (!input) return { note: null, still: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Agent 47');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    document.querySelector('button[aria-label="Continue"]').click();
    await window.__wait(() => Boolean(document.getElementById('welcome-error')), 1200);
    return {
      note: document.getElementById('welcome-error')?.textContent.trim() ?? null,
      still: Boolean(document.querySelector('#daybook-welcome')),
    };
  })()`);
  check(
    'a name with digits is refused too',
    /letters/i.test(letters.note ?? '') && letters.still === true,
    letters,
  );

  /* ------------------------------------------------ the smallest window */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const compact = await page(`(() => {
    const heading = document.getElementById('welcome-heading');
    const pill = document.querySelector('.welcome-pill');
    if (!heading || !pill) return { lines: 0, edges: false, gap: -1, inside: false, scrolls: 0, size: 0, width: 0 };
    const h = heading.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    return {
      lines: Math.round(h.height / parseFloat(getComputedStyle(heading).lineHeight)),
      edges: h.left > 0 && h.right < window.innerWidth,
      gap: Math.round(p.top - h.bottom),
      inside: p.bottom < window.innerHeight && p.top > 0 && p.right < window.innerWidth && p.left > 0,
      scrolls: document.documentElement.scrollHeight - window.innerHeight,
      size: Math.round(parseFloat(getComputedStyle(heading).fontSize)),
      width: Math.round(p.width),
    };
  })()`);
  check(
    'at 1000×600 the heading stays on one or two lines, clear of the edges',
    compact.lines >= 1 && compact.lines <= 2 && compact.edges,
    compact,
  );
  check('and the field still fits, clear of the heading', compact.inside && compact.gap >= 8, compact);
  check('with no scrollbar at the minimum window', compact.scrolls <= 1, compact);
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  /* --------------------------------------------------- name → greeting */
  const onboarded = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Your name"]');
    if (!input) return { greeted: false, greeting: null, left: false, header: false, tabs: false, heading: null };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '  Ada   Lovelace  ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // The greeting is on screen for 1.6s: catch it while it is there.
    const greeted = await window.__wait(() => {
      const line = document.querySelector('#daybook-welcome p');
      return Boolean(line && line.textContent.indexOf('Welcome,') === 0);
    }, 3000);
    const greeting = document.querySelector('#daybook-welcome p')?.textContent.trim() ?? null;
    // Any key skips the acknowledgement: pressing one now must finish well
    // inside the 1.6s the greeting would otherwise sit there for.
    const started = Date.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    const left = await window.__wait(() => !document.querySelector('#daybook-welcome'), 4000);
    const skippedIn = Date.now() - started;
    await new Promise((r) => setTimeout(r, 500));
    return {
      greeted,
      greeting,
      left,
      skippedIn,
      header: Boolean(document.querySelector('header')),
      tabs: Boolean(document.querySelector('nav[aria-label="Sections"]')),
      heading: document.querySelector('main h1')?.textContent.trim() ?? null,
    };
  })()`);
  check('Enter saves the name', onboarded.greeted === true, onboarded);
  check('the name is said back before the app opens', onboarded.greeting === 'Welcome, Ada Lovelace.', onboarded.greeting);
  check(
    'and any key skips the acknowledgement',
    onboarded.skippedIn > 0 && onboarded.skippedIn < 1200,
    { skippedInMs: onboarded.skippedIn, wouldHaveBeenMs: 2000 },
  );
  check('the screen leaves and the shell takes over', onboarded.left === true && onboarded.header && onboarded.tabs, onboarded);
  check('Home greets the owner by name', onboarded.heading === 'Today, Ada Lovelace', onboarded.heading);

  await sleep(600); // the save is debounced by 350ms
  const fresh = readData(freshDir);
  check('the name reaches the data file', fresh?.profile?.name === 'Ada Lovelace', fresh?.profile);
  check('with the moment it was given', typeof fresh?.profile?.createdAt === 'string', fresh?.profile);
  check(
    'and the greeting is recorded as done',
    fresh?.onboarding?.completed === true && fresh.onboarding.version === 1,
    fresh?.onboarding,
  );
  check('the document is saved at the current schema version', fresh?.version === 3, fresh?.version);
  check(
    'a fresh install takes no pre-migration copy (there was nothing to migrate)',
    !fs.readdirSync(path.join(freshDir, 'backups')).some((f) => f.startsWith('pre-')),
    fs.readdirSync(path.join(freshDir, 'backups')),
  );

  await endSession();

  /* ================================================================== *
   * Phase 2 — an upgrade: the owner’s own document, copied aside.
   * ================================================================== */

  const upgradeDir = scratchDir('upgrade');
  const hasLiveFile = fs.existsSync(liveDataFile);
  check('the owner’s own document is available to upgrade', hasLiveFile, liveDataFile);
  if (hasLiveFile) fs.copyFileSync(liveDataFile, path.join(upgradeDir, 'daybook.json'));
  const beforeUpgrade = hasLiveFile ? JSON.parse(fs.readFileSync(liveDataFile, 'utf8')) : null;

  await beginSession({ DAYBOOK_DATA_DIR: upgradeDir });
  check('an upgrading owner without a name is greeted once', (await page('Boolean(document.querySelector("#daybook-welcome"))')) === true);

  const copies = hasLiveFile
    ? fs.readdirSync(path.join(upgradeDir, 'backups')).filter((f) => f.startsWith('pre-'))
    : [];
  check(
    'the pre-migration copy is taken before the file is rewritten',
    hasLiveFile && copies.length === 1 &&
      fs.readFileSync(path.join(upgradeDir, 'backups', copies[0]), 'utf8') === fs.readFileSync(liveDataFile, 'utf8'),
    copies,
  );

  const upgraded = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Your name"]');
    if (!input) return { left: false, heading: document.querySelector('main h1')?.textContent.trim() ?? null };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Grace Hopper-Wells');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const left = await window.__wait(() => !document.querySelector('#daybook-welcome'), 5000);
    await new Promise((r) => setTimeout(r, 600));
    return { left, heading: document.querySelector('main h1')?.textContent.trim() ?? null };
  })()`);
  check('the upgrade is greeted and handed to Home', upgraded.left === true && upgraded.heading === 'Today, Grace Hopper-Wells', upgraded);

  const afterUpgrade = readData(upgradeDir);
  check(
    'nothing in the existing document was lost',
    JSON.stringify(census(afterUpgrade)) === JSON.stringify(census(beforeUpgrade)),
    { before: census(beforeUpgrade), after: census(afterUpgrade) },
  );

  // The name is editable in Settings, and the shell follows it (second use).
  const renamed = await page(`(async () => {
    const strip = document.querySelector('nav[aria-label="Sections"]');
    if (!strip) return { kept: null, heading: null };
    const find = (label) => [...strip.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
    find('Settings').click();
    await window.__wait(() => find('Settings').getAttribute('aria-current') === 'page');
    await new Promise((r) => setTimeout(r, 250));
    const card = document.querySelector('section[aria-labelledby="set-app"]');
    const field = card.querySelector('input[type="text"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, 'Grace Murray Hopper');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const kept = card.querySelector('input[type="text"]').value;
    find('Home').click();
    await new Promise((r) => setTimeout(r, 300));
    return { kept, heading: document.querySelector('main h1')?.textContent.trim() ?? null };
  })()`);
  check('the name is editable in Settings', renamed.kept === 'Grace Murray Hopper', renamed);
  check('and Home follows the new name', renamed.heading === 'Today, Grace Murray Hopper', renamed.heading);

  /* ---------------------------------------------------------- shell */
  const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
  const appPages = targets.filter((t) => t.type === 'page' && String(t.url).startsWith('app://'));
  check('the app opens one window and nothing else', appPages.length === 1, appPages.map((t) => t.url));

  const shell = await page(`(() => {
    const nav = [...document.querySelectorAll('nav[aria-label="Sections"] button')].map((b) => b.textContent.trim());
    const header = document.querySelector('header');
    return {
      nav,
      headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
      hasAside: Boolean(document.querySelector('aside')),
      sections: (document.body.innerText.match(/§/g) || []).length,
      colophon: /Colophon|Editions\\b|Command palette|Classifieds/i.test(document.body.innerText),
      contentHeight: Math.round(document.querySelector('main').getBoundingClientRect().height),
      viewportHeight: window.innerHeight,
    };
  })()`);
  check('exactly four tabs, in order', shell.nav.join(',') === 'Home,Timer,Activity,Settings', shell.nav);
  check('the header row is 48px tall', shell.headerHeight === 48, shell.headerHeight);
  check('the content area is the whole viewport below it', shell.contentHeight === shell.viewportHeight - 48, shell);
  check('no sidebar', !shell.hasAside);
  check('no § numbering anywhere', shell.sections === 0, shell.sections);
  check('no colophon, palette or classifieds copy', !shell.colophon);

  /* ----------------------------------------------------------- home */
  const home = await page(`(() => {
    const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent.trim());
    const columns = document.querySelectorAll('main .grid-cols-3 > section').length;
    const primary = [...document.querySelectorAll('main button')].filter((b) => b.className.includes('btn-primary'));
    // The header reads "3 tasks open" (or "1 task open"); the cap itself is
    // deliberately not printed on the Home screen.
    const tasksHeader = /(\\d+) tasks? open/.exec(document.body.innerText);
    const rows = [...document.querySelectorAll('main ul > li')].length;
    const waiting = /\\+(\\d+) waiting/.exec(document.body.innerText);
    const focus = document.body.innerText.match(/\\b(\\d+h \\d{2}m|\\d+m)\\b/);
    const progress = document.body.innerText.match(/(\\d+)%/);
    return {
      headings: headings.slice(0, 6),
      columns,
      primaryCount: primary.length,
      primaryLabel: primary[0]?.textContent.trim(),
      openTasks: tasksHeader ? Number(tasksHeader[1]) : null,
      rows,
      waiting: waiting ? Number(waiting[1]) : 0,
      focus: focus ? focus[1] : null,
      progress: progress ? progress[1] : null,
      hasQuickAdd: Boolean(document.querySelector('input[aria-label="Add a task"]')),
      hasOverallBar: Boolean(document.querySelector('[aria-label="Today\\'s progress"]')),
    };
  })()`);
  check('Home has the three column headings', home.headings.join(',') === 'Focus,Movement,Tasks', home.headings);
  check('Home shows three columns side by side', home.columns === 3, home.columns);
  check('Home has exactly one primary action', home.primaryCount === 1, home.primaryLabel);
  check('Home leads with Start focus while idle', /^Start focus|^Open timer/.test(home.primaryLabel ?? ''), home.primaryLabel);
  check('Home shows the overall progress bar', home.hasOverallBar);
  check('the task input is on screen', home.hasQuickAdd);
  check('the open-task count is within the cap', home.openTasks !== null && home.openTasks <= 7 && home.rows <= 7, {
    open: home.openTasks,
    rows: home.rows,
  });
  check('the focus figure uses the one duration format', /^(\d+h \d{2}m|\d+m)$/.test(home.focus ?? ''), home.focus);
  check('the overall figure is a percentage', /^\d+$/.test(home.progress ?? ''), home.progress);

  // The cap: adding tasks stops at seven open, with the note shown. Measured at
  // 1000×600, the tightest window the app allows.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const cap = await page(`(async () => {
    const input = document.querySelector('input[aria-label="Add a task"]');
    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // Fill the list up to the cap (it starts wherever the data left it).
    for (let i = 0; i < 9; i++) {
      const field = document.querySelector('input[aria-label="Add a task"]');
      if (field.disabled) break;
      setValue(field, 'Verification task ' + i);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 140));
    }
    const note = document.body.innerText.includes('List is full');
    const disabled = document.querySelector('input[aria-label="Add a task"]').disabled;
    // The sweep below runs with whatever data is on disk, so measure the fit of
    // a *full* list here — at the smallest supported window — while it exists.
    const main = document.querySelector('main');
    const overflow = Math.max(main.scrollHeight - main.clientHeight, main.scrollWidth - main.clientWidth);
    // The cards clip their own overflow, so a squeezed list would be cut off
    // without ever making main overflow. Measure the list itself too.
    const list = document.querySelector('section[aria-labelledby="home-tasks"] ul');
    const clipped = list ? Math.max(list.scrollHeight - list.clientHeight, list.scrollWidth - list.clientWidth) : 0;
    // Clean up: delete the three we added (hover-only × buttons are still in the DOM).
    const deletes = [...document.querySelectorAll('button[aria-label^="Delete Verification task"]')];
    deletes.forEach((b) => b.click());
    await new Promise((r) => setTimeout(r, 160));
    return {
      note,
      disabled,
      overflow,
      clipped,
      cleaned: [...document.querySelectorAll('button[aria-label^="Delete Verification task"]')].length,
    };
  })()`);
  check('the list reports itself full at seven open tasks', cap.note && cap.disabled, cap);
  check('a full task list still fits the smallest window', cap.overflow <= 1 && cap.clipped <= 1, cap);
  check('and the verification tasks were cleaned up again', cap.cleaned === 0, cap);
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  /* ---------------------------------------------------------- timer */
  await tab('Timer');
  // The timer remembers its mode between launches; start from Pomodoro so the
  // Pomodoro-only controls are actually on screen.
  await page(`(async () => {
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Pomodoro')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  })()`);
  const timerIdle = await page(`(() => {
    const seg = [...document.querySelectorAll('.seg button')].map((b) => b.textContent.trim());
    const primary = document.querySelector('main button.btn-primary');
    return {
      seg,
      primary: primary?.textContent.trim(),
      roundDots: document.querySelectorAll('main [aria-hidden="true"] span.h-2').length,
      editLink: /—\\s*Edit/.test(document.body.innerText),
      ring: Boolean(document.querySelector('svg[aria-label*="remaining"]')),
      footer: /Today .* · \\d+ session/.test(document.body.innerText),
      manual: document.body.innerText.includes('Add a session manually'),
      tags: document.body.innerText.includes('Working on:'),
    };
  })()`);
  check('Timer offers Pomodoro and Custom', timerIdle.seg.join(',') === 'Pomodoro,Custom', timerIdle.seg);
  check('Timer leads with Start', timerIdle.primary === 'Start', timerIdle.primary);
  check('the ring reports its remaining time to assistive tech', timerIdle.ring);
  check('Pomodoro shows its round dots', timerIdle.roundDots === 4, timerIdle.roundDots);
  check('the lengths link to Settings', timerIdle.editLink);
  check('the tag chips are on the timer screen', timerIdle.tags);
  check('today’s figures sit in one footer line', timerIdle.footer);
  check('a session can be added by hand', timerIdle.manual);

  const custom = await page(`(async () => {
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Custom').click();
    await new Promise((r) => setTimeout(r, 250));
    const presets = [...document.querySelectorAll('main .chip')]
      .map((c) => c.textContent.trim())
      .filter((t) => /^\\d+ min$/.test(t));
    const field = document.querySelector('input[aria-label="Timer length, hours and minutes"]');
    return {
      presets,
      fieldValue: field?.value,
      skip: document.body.innerText.includes('Skip'),
      dots: document.querySelectorAll('main [aria-hidden="true"] span.h-2').length,
    };
  })()`);
  check('Custom mode shows its presets', custom.presets.join(',') === '15 min,30 min,45 min,60 min,90 min', custom.presets);
  check('Custom mode has an editable HH:MM field', /^\d{2}:\d{2}$/.test(custom.fieldValue ?? ''), custom.fieldValue);
  check('Custom mode has no round dots and no Skip', custom.dots === 0 && !custom.skip, custom);

  // Editing the field commits a new length, remembered across a mode switch.
  const edited = await page(`(async () => {
    const field = document.querySelector('input[aria-label="Timer length, hours and minutes"]');
    field.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, '00:47');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.blur();
    await new Promise((r) => setTimeout(r, 250));
    const after = document.querySelector('input[aria-label="Timer length, hours and minutes"]')?.value;
    return { after };
  })()`);
  check('a typed length is accepted and remembered', edited.after === '00:47', edited);

  // Start, then Space toggles, then reset discards.
  const running = await page(`(async () => {
    document.querySelector('main button.btn-primary').click();
    await new Promise((r) => setTimeout(r, 400));
    const label = document.querySelector('main button.btn-primary')?.textContent.trim();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const afterSpace = document.querySelector('main button.btn-primary')?.textContent.trim();
    return { label, afterSpace };
  })()`);
  check('Start begins the session', running.label === 'Pause', running);
  check('Space pauses it again (Timer tab only)', running.afterSpace === 'Start', running);

  const reset = await page(`(async () => {
    const reset = [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Reset');
    reset.click();
    await new Promise((r) => setTimeout(r, 300));
    const clock = document.querySelector('main p.font-mono')?.textContent.trim();
    const dialog = document.querySelector('[role="alert"]');
    return { clock, confirmShown: Boolean(dialog), field: document.querySelector('input[aria-label="Timer length, hours and minutes"]')?.value };
  })()`);
  check('Reset under a minute discards without a confirmation', !reset.confirmShown, reset);

  /* ------------------------------------------------- the timer persists */
  // The clock lives in the main process against an end timestamp, so a full
  // renderer reload (the harshest version of "minimise, tray, reload") must not
  // stop it or reset it.
  await tab('Timer');
  // The digits are an odometer (each strip holds all ten glyphs), so read the
  // clock the way assistive tech does: off the ring's label.
  const readTimer = `(async () => {
    await new Promise((r) => setTimeout(r, 400));
    const ring = document.querySelector('svg[aria-label*="remaining"]');
    const spoken = ring ? ring.getAttribute('aria-label') : '';
    const tokens = spoken.replace(/[^0-9:]/g, ' ').trim().split(/[ ]+/);
    const clock = tokens.filter((t) => /[0-9]/.test(t) && t.indexOf(':') >= 0)[0] ?? '';
    const parts = clock.split(':').map(Number);
    const seconds = parts.length === 2 && parts.every((n) => !Number.isNaN(n)) ? parts[0] * 60 + parts[1] : NaN;
    const segment = [...document.querySelectorAll('.seg button')].find((b) => b.getAttribute('aria-pressed') === 'true');
    return {
      label: document.querySelector('main button.btn-primary')?.textContent.trim(),
      clock: clock,
      seconds: seconds,
      mode: segment ? segment.textContent.trim() : null,
      modeDisabled: [...document.querySelectorAll('.seg button')].every((b) => b.disabled),
    };
  })()`;
  const startedForReload = await page(`(async () => {
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Pomodoro')?.click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('main button.btn-primary').click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  })()`).then(() => page(readTimer));
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(4000);
  const afterReload = await tab('Timer').then(() => page(readTimer));
  const elapsed = startedForReload.seconds - afterReload.seconds;
  check('a running timer survives a reload (it lives in the main process)', startedForReload.label === 'Pause' && afterReload.label === 'Pause' && afterReload.mode === 'Pomodoro', { startedForReload, afterReload });
  check('and it kept counting down while the window was away', elapsed >= 3 && elapsed <= 60, { before: startedForReload.clock, after: afterReload.clock, elapsed });
  check('the mode switch is locked while the clock runs', afterReload.modeDisabled === true, afterReload);
  await page(`(async () => {
    [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Reset')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  })()`);

  /* --------------------------------------- the home card starts the clock */
  await tab('Home');
  const homeStart = await page(`(async () => {
    const button = [...document.querySelectorAll('main button')].find((b) => b.className.includes('btn-primary'));
    const label = button?.textContent.trim();
    button?.click();
    await new Promise((r) => setTimeout(r, 700));
    const tab = document.querySelector('nav[aria-label="Sections"] button[aria-current="page"]')?.textContent.trim();
    const timerButton = document.querySelector('main button.btn-primary')?.textContent.trim();
    return { label, tab, timerButton };
  })()`);
  check('Start focus hands the job to the Timer and starts it', homeStart.label === 'Start focus' && homeStart.tab === 'Timer' && homeStart.timerButton === 'Pause', homeStart);

  const homeRunning = await tab('Home').then(() =>
    page(`(async () => {
      await new Promise((r) => setTimeout(r, 400));
      const button = document.querySelector('main button.btn-primary');
      return { label: button?.textContent.replace(/[0-9]/g, '').trim(), hasClock: /[0-9]+:[0-9]{2}/.test(button?.textContent ?? ''), disabled: button?.disabled };
    })()`),
  );
  check('Home offers Open timer while a session runs', homeRunning.label.startsWith('Open timer') && homeRunning.hasClock, homeRunning);
  const backToTimer = await page(`(async () => {
    document.querySelector('main button.btn-primary')?.click();
    await new Promise((r) => setTimeout(r, 500));
    const tab = document.querySelector('nav[aria-label="Sections"] button[aria-current="page"]')?.textContent.trim();
    [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Reset')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return { tab };
  })()`);
  check('and Open timer comes back to the running clock', backToTimer.tab === 'Timer', backToTimer);

  // Fullscreen: F11 in, Esc out.
  const full = await page(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11', bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const header = document.querySelector('header');
    const seg = document.querySelector('.seg');
    const primary = document.querySelector('main button.btn-primary')?.textContent.trim();
    const extras = [...document.querySelectorAll('main button')].map((b) => b.textContent.trim());
    return { header: Boolean(header), seg: Boolean(seg), primary, extras };
  })()`);
  check('fullscreen hides the shell chrome', !full.header && !full.seg, full);
  check('fullscreen keeps the start control', full.primary === 'Start', full);
  check('fullscreen drops the secondary controls', !full.extras.includes('Reset') && !full.extras.includes('Skip'), full.extras);
  const left = await page(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    return { header: Boolean(document.querySelector('header')), tab: document.querySelector('nav[aria-label="Sections"] button[aria-current="page"]')?.textContent.trim() };
  })()`);
  check('Esc leaves fullscreen and restores the tabs', left.header && left.tab === 'Timer', left);

  /* ------------------------------------------------------- activity */
  await tab('Activity');
  const activity = await page(`(() => {
    const cells = [...document.querySelectorAll('button[data-cell]')];
    const levels = new Set(cells.map((c) => c.dataset.level));
    const figures = [...document.querySelectorAll('main .grid-cols-4 > div')].map((d) => d.textContent.replace(/\\s+/g, ' ').trim());
    const chart = document.querySelector('svg[role="img"][aria-label*="Focus time over"]');
    return {
      cells: cells.length,
      columns: new Set(cells.map((c) => c.dataset.col)).size,
      levels: [...levels].sort(),
      figures,
      chartLabel: chart?.getAttribute('aria-label'),
      hasTagChart: document.body.innerText.includes('By tag'),
      filters: [...document.querySelectorAll('.seg button')].map((b) => b.textContent.trim()),
      caption: /(\\d+) active days in the last 12 months/.exec(document.body.innerText)?.[1],
    };
  })()`);
  check('the heatmap is 53 weeks of seven days', activity.cells === 371 && activity.columns === 53, activity);
  check('five intensity levels are in use', activity.levels.length >= 4 && activity.levels[0] === '0', activity.levels);
  check('the four figures are on screen', activity.figures.length === 4, activity.figures);
  check('the caption counts active days, not printed pages', /^\d+$/.test(activity.caption ?? ''), activity.caption);
  check('the filter offers Combined/Focus/Movement/Tasks', activity.filters.join(',') === 'Combined,Focus,Movement,Tasks,30D,12W,1Y', activity.filters);
  check('the chart summarises itself for assistive tech', /last 30 days/.test(activity.chartLabel ?? ''), activity.chartLabel);
  check('the best day is never in the future', (() => {
    const best = activity.figures.find((f) => f.startsWith('Best day')) ?? '';
    const match = /· (\\d{1,2}) (\\w{3})/.exec(best);
    if (!match) return true;
    const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[2]);
    const now = new Date();
    if (month === -1) return true;
    return month < now.getMonth() || (month === now.getMonth() && Number(match[1]) <= now.getDate());
  })(), activity.figures);

  const filterSwitch = await page(`(async () => {
    const levelHash = () => [...document.querySelectorAll('button[data-cell]')].map((c) => c.dataset.level).join('');
    const before = levelHash();
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Focus').click();
    await new Promise((r) => setTimeout(r, 300));
    const afterFocus = levelHash();
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === '12W').click();
    await new Promise((r) => setTimeout(r, 300));
    const label = document.querySelector('svg[role="img"][aria-label*="Focus time over"]')?.getAttribute('aria-label');
    const streakLabel = document.body.innerText.match(/Streak · (\\w+)/)?.[1];
    return { changed: before !== afterFocus, label, streakLabel };
  })()`);
  check('switching the filter repaints the heatmap', filterSwitch.changed);
  check('the streak figure follows the filter', filterSwitch.streakLabel === 'Focus', filterSwitch);
  check('the range toggle drives the chart', /last 12 weeks/.test(filterSwitch.label ?? ''), filterSwitch.label);

  const tooltip = await page(`(async () => {
    const cell = [...document.querySelectorAll('button[data-cell]')].filter((c) => c.dataset.level !== '0').pop();
    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const tip = document.querySelector('[data-tip="heatmap"]');
    if (!tip) return { found: false };
    const style = getComputedStyle(tip);
    const box = tip.getBoundingClientRect();
    const container = document.querySelector('button[data-cell]').parentElement.getBoundingClientRect();
    return {
      found: true,
      // An opaque tooltip has no alpha channel: rgb(...) rather than rgba(..., 0).
      opaque: style.backgroundColor.startsWith('rgb('),
      inside: box.left >= container.left - 2 && box.right <= container.right + 2,
      above: box.bottom <= cell.getBoundingClientRect().top + 2,
      hasFigures: /focus · \\d+ min movement · \\d+ task/.test(tip.textContent),
    };
  })()`);
  check('the tooltip appears', tooltip.found, tooltip);
  check('the tooltip is opaque', tooltip.opaque, tooltip);
  check('the tooltip is clamped inside the grid', tooltip.inside, tooltip);
  check('the tooltip sits above the cell', tooltip.above, tooltip);
  check('the tooltip carries the day’s figures', tooltip.hasFigures, tooltip);

  const dayDialog = await page(`(async () => {
    const cell = [...document.querySelectorAll('button[data-cell]')].filter((c) => c.dataset.level !== '0').pop();
    cell.click();
    await new Promise((r) => setTimeout(r, 400));
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.innerText ?? '';
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label') || b.textContent.trim());
    return {
      open: Boolean(dialog),
      heading: dialog?.getAttribute('aria-label'),
      hasAddSession: text.includes('Add session'),
      hasAddMovement: text.includes('Add movement'),
      hasFocusSection: text.includes('Focus sessions'),
      hasMovementSection: text.includes('Movement'),
      hasTasksSection: text.includes('Tasks done'),
      deleteButtons: buttons.filter((b) => /^Delete/.test(b)).length,
    };
  })()`);
  check('a day opens in a dialog', dayDialog.open && /\d{4}/.test(dayDialog.heading ?? ''), dayDialog);
  check('the dialog edits sessions, movement and tasks', dayDialog.hasFocusSection && dayDialog.hasMovementSection && dayDialog.hasTasksSection, dayDialog);
  check('the dialog can add a session and a movement', dayDialog.hasAddSession && dayDialog.hasAddMovement, dayDialog);
  check('rows can be deleted in place', dayDialog.deleteButtons >= 0);

  const closed = await page(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return !document.querySelector('[role="dialog"]');
  })()`);
  check('Esc closes the day dialog', closed === true);

  /* ------------------------------------------------------- settings */
  await tab('Settings');
  const settings = await page(`(() => {
    const cards = [...document.querySelectorAll('main section')].map((s) => s.querySelector('h2')?.textContent.trim());
    return {
      cards,
      version: /Daybook (\\d+\\.\\d+\\.\\d+)/.exec(document.body.innerText)?.[1],
      versionOnHome: false,
      theme: [...document.querySelectorAll('.seg button')].map((b) => b.textContent.trim()),
      toggles: [...document.querySelectorAll('[role="switch"]')].length,
      goals: [...document.querySelectorAll('input[type="number"]')].length,
      privacy: document.body.innerText.includes('Nothing is sent anywhere'),
      erase: document.body.innerText.includes('Erase all data'),
      removed: /Tick while running|Check for updates|Week starts|grace day|Backups|Colophon|Electron/i.test(document.body.innerText),
      nameRow: (() => {
        const card = document.querySelector('section[aria-labelledby="set-app"]');
        const field = card ? card.querySelector('input[type="text"]') : null;
        return field ? { label: field.getAttribute('aria-label'), value: field.value } : null;
      })(),
    };
  })()`);
  check('the name has a row of its own in App', settings.nameRow?.label === 'Your name' && settings.nameRow.value.length > 0, settings.nameRow);
  check('Settings is four cards', settings.cards.join(',') === 'Daily goals,App,Timer,Data', settings.cards);
  // Read from package.json rather than written here, so a version bump cannot
  // leave this check asserting the release before last.
  check(
    `the version is ${pkg.version} and lives here`,
    settings.version === pkg.version && settings.versionOnHome === false,
    settings.version,
  );
  check('theme offers Auto, Light and Dark', settings.theme.join(',') === 'Auto,Light,Dark', settings.theme);
  check('the switches are real switches', settings.toggles >= 5, settings.toggles);
  check('the removed settings are gone', !settings.removed);
  check('one destructive action, no extras', settings.erase && settings.privacy, settings);

  // Clamp check: an absurd goal is clamped and the flash confirms the save.
  const clamp = await page(`(async () => {
    // Scoped to the Daily goals card: the Timer tab also has a field labelled
    // "Focus in min", and querying by label alone read whichever came first in
    // the DOM — which made this check pass or fail depending on tab order.
    const find = () => document.querySelectorAll('section[aria-labelledby="set-goals"] input[aria-label="Focus in min"]');
    const input = find()[0];
    const original = input.value;
    const limits = [...find()].map((i) => i.min + '–' + i.max);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    let blurred = false;
    input.addEventListener('blur', () => { blurred = true; }, { once: true });
    input.focus();
    const focused = document.activeElement === input;
    setter.call(input, '99999');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // A window that does not hold OS focus never fires a real blur — the element
    // cannot become the focus owner — which made this check flaky depending on
    // what else was on screen. focusout is the event React's onBlur listens for,
    // so the commit is driven directly; when a real blur did fire this is a
    // second, idempotent commit. The assertion is unchanged: the app must clamp
    // the figure when the field is committed.
    input.blur();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await window.__wait(() => find()[0]?.value !== '99999', 8000);
    const clamped = find()[0]?.value;
    const saved = await window.__wait(() => document.body.innerText.includes('Saved'), 1500);
    // Restore the original goal so the run leaves no trace.
    const field = find()[0];
    setter.call(field, original);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    field.blur();
    await new Promise((r) => setTimeout(r, 400));
    return {
      clamped,
      saved,
      restored: find()[0]?.value,
      original,
      // Diagnostics: a failed clamp is either "the app did not commit" or
      // "the document did not focus", and those need different fixes.
      fields: limits,
      focused,
      blurred,
      pageFocused: document.hasFocus(),
    };
  })()`);
  check('an out-of-range figure is clamped on blur', clamp.clamped === '720', clamp);
  check('the save is confirmed quietly, not by a button', clamp.saved === true, clamp);
  check('the verification restored the original goal', clamp.restored === clamp.original, clamp);

  const theme = await page(`(async () => {
    const before = document.documentElement.classList.contains('dark');
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Dark').click();
    await new Promise((r) => setTimeout(r, 400));
    const dark = document.documentElement.classList.contains('dark');
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Auto').click();
    await new Promise((r) => setTimeout(r, 400));
    const after = document.documentElement.classList.contains('dark');
    return { before, dark, after };
  })()`);
  check('choosing Dark repaints the app as the night edition', theme.dark === true, theme);
  check('and Auto returns it to the Windows setting', theme.after === theme.before, theme);

  const erase = await page(`(async () => {
    const started = Date.now();
    [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('Erase all data')).click();
    await new Promise((r) => setTimeout(r, 350));
    const dialog = document.querySelector('[role="dialog"]');
    const open = Boolean(dialog);
    const confirmButton = [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('Erase everything'));
    const disabledBefore = confirmButton.disabled;
    const field = dialog.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, 'delete');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const enabledAfter = ![...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('Erase everything')).disabled;
    // Cancel — never confirm a destructive dialog in a verification run.
    [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel').click();
    const closed = await window.__wait(() => !document.querySelector('[role="dialog"]'));
    // How promptly the renderer answered, so a stalled window is visible in the
    // failure rather than guessed at.
    const tick = Date.now();
    await new Promise((r) => setTimeout(r, 30));
    return { open, disabledBefore, enabledAfter, closed, totalMs: Date.now() - started, tickMs: Date.now() - tick };
  })()`);
  check('Erase asks for a typed confirmation', erase.open && erase.disabledBefore === true && erase.enabledAfter === true, erase);
  check('and cancelling closes it untouched', erase.closed === true, erase);

  /* --------------------------------------------- keyboard tab order */
  const keyboardTabs = await page(`(async () => {
    const seen = [];
    for (const combo of ['1', '2', '3', '4']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: combo, ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 280));
      seen.push(document.querySelector('nav[aria-label="Sections"] button[aria-current="page"]')?.textContent.trim());
    }
    return seen;
  })()`);
  check('Ctrl+1…4 walk the tabs', keyboardTabs.join(',') === 'Home,Timer,Activity,Settings', keyboardTabs);

  /* ---------------------------------------------------- layout sweep */
  // Ride out a cold machine: a freshly built binary can be scanned by the
  // antivirus on first launch, and a covered window is throttled by Chromium.
  if (!NO_RAISE) await cdp.send('Page.bringToFront').catch(() => {});
  const cases = [
    { label: '1000×600 @100%', width: 1000, height: 600, scale: 1 },
    { label: '1280×720 @100%', width: 1280, height: 720, scale: 1 },
    { label: '1280×720 @125%', width: 1280, height: 720, scale: 1.25 },
    { label: '1366×768 @100%', width: 1366, height: 768, scale: 1 },
    { label: '1366×768 @125%', width: 1366, height: 768, scale: 1.25 },
    { label: '1920×1080 @100%', width: 1920, height: 1080, scale: 1 },
    { label: '1920×1080 @125%', width: 1920, height: 1080, scale: 1.25 },
    { label: '1920×1080 @150%', width: 1920, height: 1080, scale: 1.5 },
  ];
  const layoutFails = [];
  for (const testCase of cases) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: testCase.width,
      height: testCase.height,
      deviceScaleFactor: testCase.scale,
      mobile: false,
    });
    const measured = await page(`(async () => {
      const out = [];
      const strip = document.querySelector('nav[aria-label="Sections"]');
      for (const label of ['Home', 'Timer', 'Activity', 'Settings']) {
        const button = [...strip.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
        button?.click();
        await window.__wait(() => button?.getAttribute('aria-current') === 'page', 4000);
        await new Promise((r) => setTimeout(r, 120));
        const main = document.querySelector('main');
        const root = document.documentElement;
        const scrollables = [...document.querySelectorAll('*')].filter((el) => {
          const style = getComputedStyle(el);
          const canScroll = /(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflowX);
          return canScroll && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
        }).map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.'));
        // Name the culprit when something does overflow: the check is only
        // useful if a failure says *what* is too wide or too tall.
        const box = main.getBoundingClientRect();
        const wide = [...main.querySelectorAll('*')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 2 && (r.right > box.right + 2 || r.left < box.left - 2);
          })
          .slice(0, 4)
          .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' ' + Math.round(el.getBoundingClientRect().width) + 'px');
        // A card clips its own overflow, so a row that does not fit is cut off
        // silently: no scrollbar, no page overflow, just a missing line.
        const clipped = [...main.querySelectorAll('.card-body')]
          .map((el) => el.scrollHeight - el.clientHeight)
          .filter((n) => n > 1);
        out.push({
          tab: label,
          dy: root.scrollHeight - window.innerHeight,
          dx: root.scrollWidth - window.innerWidth,
          mdy: main.scrollHeight - main.clientHeight,
          mdx: main.scrollWidth - main.clientWidth,
          wide,
          scrollables,
          clipped,
        });
      }
      return JSON.stringify(out);
    })()`, 90_000);
    for (const row of measured) {
      const clean =
        row.dy <= 1 && row.dx <= 1 && row.mdy <= 1 && row.mdx <= 1 &&
        row.scrollables.length === 0 && row.clipped.length === 0;
      if (!clean) layoutFails.push({ case: testCase.label, ...row });
    }
  }
  // (each case evaluates the whole DOM four times; slow machines need room)
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  check(
    'no tab scrolls or clips at any supported size or scaling',
    layoutFails.length === 0,
    layoutFails.slice(0, 4),
  );

  /* ------------------------------------------------- text legibility */
  // Every visible piece of text must be at least 12px and reach 4.5:1 against
  // the colour actually painted behind it. Run over a root selector so the
  // dialogs (which live outside `main`) can be measured too.
  const legibilityProbe = (rootSelector) => `(async function () {
    var luminance = function (rgb) {
      var channel = function (v) {
        var c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    };
    var parse = function (value) {
      var parts = value.replace(/[^0-9.,]/g, ' ').trim().split(/[ ,]+/).map(Number);
      if (parts.length < 3 || parts.some(function (n) { return Number.isNaN(n); })) return null;
      return { rgb: [parts[0], parts[1], parts[2]], alpha: parts.length > 3 ? parts[3] : 1 };
    };
    var behind = function (el) {
      var node = el;
      while (node) {
        var bg = getComputedStyle(node).backgroundColor;
        var parsed = parse(bg);
        if (parsed && parsed.alpha > 0.95) return parsed.rgb;
        node = node.parentElement;
      }
      return [255, 255, 255];
    };
    var bad = [];
    var worst = null;
    var tabs = ['Home', 'Timer', 'Activity', 'Settings'];
    var worstRatio = 99;
    var roots = ${JSON.stringify(rootSelector)} === 'main *' ? tabs : ['dialog'];
    for (var i = 0; i < roots.length; i++) {
      if (roots[i] !== 'dialog') {
        var button = [].slice.call(document.querySelectorAll('nav[aria-label="Sections"] button'))
          .filter(function (b) { return b.textContent.trim() === roots[i]; })[0];
        if (button) button.click();
        await new Promise(function (r) { setTimeout(r, 260); });
      }
      var nodes = document.querySelectorAll(${JSON.stringify(rootSelector)});
      for (var n = 0; n < nodes.length; n++) {
        var el = nodes[n];
        var own = '';
        for (var c = 0; c < el.childNodes.length; c++) {
          if (el.childNodes[c].nodeType === 3) own += el.childNodes[c].nodeValue;
        }
        own = own.trim();
        if (!own) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width < 3 || rect.height < 3) continue;
        var style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        // Screen-reader-only text is deliberately not painted: the 1px clipped
        // box would otherwise read as a contrast failure.
        if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') continue;
        var size = parseFloat(style.fontSize);
        var fg = parse(style.color);
        if (!fg) continue;
        var bg = behind(el);
        var a = luminance(fg.rgb);
        var b = luminance(bg);
        var ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        var where = roots[i] + ' · ' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0];
        var label = own.slice(0, 30);
        if (size < 12 - 0.01) bad.push({ where: where, size: Math.round(size * 10) / 10, text: label });
        else if (ratio < 4.5 && worstRatio > ratio) {
          worstRatio = ratio;
          worst = { where: where, ratio: Math.round(ratio * 100) / 100, size: Math.round(size), text: label };
        }
      }
    }
    return JSON.stringify({ bad: bad.slice(0, 8), badCount: bad.length, worst: worst });
  })()`;

  const legibility = await page(legibilityProbe('main *'), 90_000);
  check('all text is at least 12px', legibility.badCount === 0, legibility.bad);
  check('all text reaches 4.5:1 contrast', legibility.worst === null, legibility.worst);

  // The dialogs: the disabled "Erase everything" button and the day editor are
  // where a washed-out accent fill would hide.
  const eraseLight = await page(`(async () => {
    [...document.querySelectorAll('main button')].find((b) => b.textContent.includes('Erase all data'))?.click();
    await new Promise((r) => setTimeout(r, 350));
    return Boolean(document.querySelector('[role="dialog"]'));
  })()`);
  const dialogLegibility = eraseLight ? await page(legibilityProbe('[role="dialog"] *, [role="dialog"]'), 60_000) : null;
  check('the erase dialog is legible too', dialogLegibility !== null && dialogLegibility.badCount === 0 && dialogLegibility.worst === null, dialogLegibility);
  await page(`(async () => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Cancel')?.click();
    return await window.__wait(() => !document.querySelector('[role="dialog"]'));
  })()`);

  /* --------------------------------------------------------- shots */
  if (SHOTS) {
    const dir = path.resolve(root, SHOTS);
    fs.mkdirSync(dir, { recursive: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: Number.isFinite(SHOT_SIZE[0]) ? SHOT_SIZE[0] : 1280,
      height: Number.isFinite(SHOT_SIZE[1]) ? SHOT_SIZE[1] : 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const shotLabels = ['Home', 'Timer', 'Activity', 'Settings'];
    const captured = [];
    for (const label of shotLabels) {
      await tab(label);
      const shot = await capture();
      if (!shot) {
        warn(`[verify] could not capture the ${label} tab — the window is not compositing`);
        continue;
      }
      fs.writeFileSync(path.join(dir, `${label.toLowerCase()}.png`), Buffer.from(shot.data, 'base64'));
      captured.push(label);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // One page to review the first-run screen and the tabs side by side, with
    // the captions that matter for a visual pass. The images are referenced,
    // not embedded, so the gallery stays small and can be rebuilt in place.
    const figures = [
      ...(fs.existsSync(path.join(dir, 'welcome.png')) ? ['Welcome'] : []),
      ...captured,
    ]
      .map(
        (label) =>
          `<figure><figcaption>${label}</figcaption>` +
          `<img src="./${label.toLowerCase()}.png" alt="Daybook ${label}"></figure>`,
      )
      .join('\n');
    fs.writeFileSync(
      path.join(dir, 'gallery.html'),
      `<!doctype html><meta charset="utf-8"><title>Daybook 1.2.0 — first run and the four tabs</title>
<style>
  body{margin:0;background:#111;color:#eee;font:13px/1.4 system-ui;padding:16px}
  h1{font-size:15px;font-weight:600;margin:0 0 4px}
  p.lede{margin:0 0 16px;opacity:.65}
  figure{margin:0 0 24px}
  figcaption{text-transform:uppercase;letter-spacing:.12em;font-size:11px;opacity:.7;margin-bottom:6px}
  img{width:1280px;max-width:100%;height:auto;display:block;border:1px solid #333;border-radius:4px}
</style>
<h1>Daybook 1.2.0</h1>
<p class="lede">The first-run screen (at 1536×1024) and the four tabs (at 1280×720), from the packaged build.</p>
${figures}
`,
      'utf8',
    );
    console.log(`\u001b[2mscreenshots + gallery.html → ${path.relative(root, dir)}\u001b[0m`);
  }

  /* --------------------------------------------------------- cleanup */
  const tidy = await page(`(async () => {
    [...document.querySelectorAll('nav[aria-label="Sections"] button')].find((b) => b.textContent.trim() === 'Timer')?.click();
    await new Promise((r) => setTimeout(r, 250));
    // Leave the app as we found it: Pomodoro, stopped, at its full length.
    [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Pomodoro')?.click();
    await new Promise((r) => setTimeout(r, 250));
    const reset = [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Reset');
    reset?.click();
    await new Promise((r) => setTimeout(r, 250));
    const primary = document.querySelector('main button.btn-primary')?.textContent.trim();
    return { primary };
  })()`);
  check('the run leaves the timer stopped and tidy', tidy.primary === 'Start', tidy);

  /* --------------------------------------------------------- console */
  const errors = await page('JSON.stringify(window.__errors || [])');
  check('the renderer logged no errors or warnings', Array.isArray(errors) && errors.length === 0, errors);

  await endSession();

  /* ================================================================== *
   * Phase 3 — a named document is never asked again.
   * ================================================================== */

  await beginSession({ DAYBOOK_DATA_DIR: upgradeDir });
  const settled = await page(`(async () => {
    // Long enough that a screen on its way would have arrived.
    await new Promise((r) => setTimeout(r, 1500));
    return {
      welcome: Boolean(document.querySelector('#daybook-welcome')),
      header: Boolean(document.querySelector('header')),
      tabs: Boolean(document.querySelector('nav[aria-label="Sections"]')),
      heading: document.querySelector('main h1')?.textContent.trim() ?? null,
    };
  })()`);
  check('a saved name means the Welcome screen never comes back', settled.welcome === false, settled);
  check(
    'the app opens straight into Home, under that name',
    settled.header && settled.tabs && settled.heading === 'Today, Grace Murray Hopper',
    settled,
  );
  check(
    'and a second launch takes no further pre-migration copy',
    fs.readdirSync(path.join(upgradeDir, 'backups')).filter((f) => f.startsWith('pre-')).length === 1,
    fs.readdirSync(path.join(upgradeDir, 'backups')),
  );
  await endSession();

  /* ================================================================== *
   * Phase 4 — DAYBOOK_FORCE_ONBOARDING=1 asks for it again, for review.
   * ================================================================== */

  await beginSession({ DAYBOOK_DATA_DIR: upgradeDir, DAYBOOK_FORCE_ONBOARDING: '1' });
  const forced = await page(`(async () => {
    await new Promise((r) => setTimeout(r, 800));
    const heading = document.getElementById('welcome-heading');
    return {
      welcome: Boolean(document.querySelector('#daybook-welcome')),
      heading: heading ? heading.textContent.replace(/\\s+/g, ' ').trim() : null,
      named: Boolean(document.querySelector('main h1')),
    };
  })()`);
  check('DAYBOOK_FORCE_ONBOARDING=1 brings the screen back for testing', forced.welcome === true, forced);
  check(
    'and the forced screen is the same one, not a fallback',
    forced.heading === 'What shall we call you, Knight?' && forced.named === false,
    forced,
  );
  // Left running only for `--keep-open`; the review session is the last one.
  if (!KEEP_OPEN) await endSession();

  /* ------------------------------------------------------ the bundle */
  // What the installer actually carries for the photograph: one optimised file,
  // never the multi-megabyte PNG it was cut from.
  const assetDir = path.join(root, 'dist', 'assets');
  const shipped = fs.existsSync(assetDir) ? fs.readdirSync(assetDir) : [];
  const pictures = shipped.filter((f) => /\.(webp|avif)$/i.test(f));
  const heaviest = pictures.reduce((n, f) => Math.max(n, fs.statSync(path.join(assetDir, f)).size), 0);
  check(
    'the background ships as one optimised image under 500 KB',
    pictures.length === 1 && heaviest <= 500 * 1024,
    { pictures, kb: Math.round(heaviest / 1024) },
  );
  check('and the source PNG is not shipped at all', !shipped.some((f) => /\.png$/i.test(f)), shipped);

  /* ---------------------------------------------------------- report */
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  • ${f.name}${f.detail === undefined ? '' : ` — ${JSON.stringify(f.detail)}`}`);
    if (appLog.trim()) console.log(`\nApp log:\n${appLog.trim().split('\n').slice(-25).join('\n')}`);
  }
  if (KEEP_OPEN) console.log('\n--keep-open: the app is still running.');
  else shutdown();
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error(`\nverify failed: ${error.message}`);
  if (appLog.trim()) console.error(`\nApp log:\n${appLog.trim().split('\n').slice(-30).join('\n')}`);
  shutdown();
  process.exit(2);
}

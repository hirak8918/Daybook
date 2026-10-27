/**
 * Layout check — the "one screen, no scroll" rule, measured.
 *
 *   node scripts/scale-check.mjs --port 9222
 *
 * Walks all four tabs at every window size and display scaling the release must
 * support (1000×600, 1280×720, 1366×768 and 1920×1080 at 100/125/150 %) and
 * asserts that:
 *
 *   · the document never scrolls in either axis
 *   · the content area never clips or scrolls its own children
 *   · no element anywhere is scrollable while the Day dialog is closed
 *
 * Run it against the packaged build for the real thing.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : '9222';

const cases = [
  { label: '1000×600 @100% (the minimum window)', width: 1000, height: 600, scale: 1 },
  { label: '1280×720 @100%', width: 1280, height: 720, scale: 1 },
  { label: '1280×720 @125%', width: 1280, height: 720, scale: 1.25 },
  { label: '1366×768 @100%', width: 1366, height: 768, scale: 1 },
  { label: '1366×768 @125%', width: 1366, height: 768, scale: 1.25 },
  { label: '1920×1080 @100%', width: 1920, height: 1080, scale: 1 },
  { label: '1920×1080 @125%', width: 1920, height: 1080, scale: 1.25 },
  { label: '1920×1080 @150%', width: 1920, height: 1080, scale: 1.5 },
];

function inspect(extra) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'inspect.mjs'), '--port', port, ...extra], {
    encoding: 'utf8',
    cwd: root,
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error(`inspect failed: ${extra.slice(0, 2).join(' ')}`);
  }
  return result.stdout.trim();
}

const measure = `(async () => {
  const out = [];
  const labels = ['Home', 'Timer', 'Activity', 'Settings'];
  for (const label of labels) {
    const button = [...document.querySelectorAll('nav[aria-label="Sections"] button')].find(
      (b) => b.textContent.trim() === label,
    );
    if (!button) { out.push({ tab: label, missing: true }); continue; }
    button.click();
    await new Promise((r) => setTimeout(r, 320));

    const main = document.querySelector('main');
    const root = document.documentElement;
    // Anything that is scrollable *and* currently overflowing is a violation;
    // nothing in the app should be scrollable except the Day dialog.
    const scrollables = [...document.querySelectorAll('*')].filter((el) => {
      const style = getComputedStyle(el);
      const canScroll = /(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflowX);
      return canScroll && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    }).map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.'));

    out.push({
      tab: label,
      docOverflowY: root.scrollHeight - window.innerHeight,
      docOverflowX: root.scrollWidth - window.innerWidth,
      mainOverflowY: main ? main.scrollHeight - main.clientHeight : 0,
      mainOverflowX: main ? main.scrollWidth - main.clientWidth : 0,
      scrollables,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      dpr: devicePixelRatio,
    });
  }
  return JSON.stringify(out);
})()`;

const results = [];
for (const testCase of cases) {
  inspect([
    '--method',
    'Emulation.setDeviceMetricsOverride',
    '--params',
    JSON.stringify({
      width: testCase.width,
      height: testCase.height,
      deviceScaleFactor: testCase.scale,
      mobile: false,
    }),
  ]);

  const measured = JSON.parse(inspect(['--eval', measure]));
  for (const row of measured) {
    const clean =
      !row.missing &&
      row.docOverflowY <= 1 &&
      row.docOverflowX <= 1 &&
      row.mainOverflowY <= 1 &&
      row.mainOverflowX <= 1 &&
      row.scrollables.length === 0;
    results.push({ case: testCase.label, ...row, clean });
    console.log(
      `${clean ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m'} ${testCase.label.padEnd(38)} ` +
        `${row.tab.padEnd(9)} doc ${row.docOverflowX}/${row.docOverflowY}px · content ${row.mainOverflowX}/${row.mainOverflowY}px` +
        (row.scrollables?.length ? ` · scrolling: ${row.scrollables.join(', ')}` : ''),
    );
  }
}

inspect(['--method', 'Emulation.clearDeviceMetricsOverride']);

const failed = results.filter((r) => !r.clean);
console.log(`\n${results.length - failed.length}/${results.length} tab/viewport combinations laid out cleanly`);
process.exit(failed.length ? 1 : 0);

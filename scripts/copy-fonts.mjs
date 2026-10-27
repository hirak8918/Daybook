/**
 * Copies the three bundled font families out of node_modules into
 * src/assets/fonts so the app is 100% offline: no CDN, no @import, no
 * network at runtime. Re-runnable: `npm run assets`.
 *
 *   Display → Fraunces (variable: optical size + weight + SOFT/WONK axes)
 *   Text    → Geist Sans (variable, + variable italic)
 *   Mono    → JetBrains Mono (400 / 500 / 700, tabular figures for timers)
 *
 * Swap a family by editing FONTS below and updating src/styles/fonts.css.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'src', 'assets', 'fonts');

const FONTS = [
  {
    from: 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2',
    to: 'fraunces-var.woff2',
  },
  {
    from: 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2',
    to: 'fraunces-var-italic.woff2',
  },
  { from: 'node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2', to: 'geist-sans-var.woff2' },
  { from: 'node_modules/geist/dist/fonts/geist-sans/Geist-Italic[wght].woff2', to: 'geist-sans-var-italic.woff2' },
  {
    from: 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
    to: 'jetbrains-mono-400.woff2',
  },
  {
    from: 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2',
    to: 'jetbrains-mono-500.woff2',
  },
  {
    from: 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2',
    to: 'jetbrains-mono-700.woff2',
  },
];

fs.mkdirSync(outDir, { recursive: true });
let copied = 0;
let missing = 0;

for (const font of FONTS) {
  const src = path.join(root, font.from);
  const dest = path.join(outDir, font.to);
  if (!fs.existsSync(src)) {
    console.warn(`[fonts] missing source: ${font.from} (run npm install)`);
    missing++;
    continue;
  }
  fs.copyFileSync(src, dest);
  const kb = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`[fonts] ${font.to}  (${kb} kB)`);
  copied++;
}

if (missing) {
  console.warn(
    `[fonts] ${missing} file(s) missing. The app still runs with the local fallback stack defined in src/styles/fonts.css.`,
  );
}
console.log(`[fonts] ${copied} font file(s) bundled locally in src/assets/fonts`);

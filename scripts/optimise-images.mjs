/**
 * Optimises the source images into the files the app actually ships.
 *
 *   assets/onboarding/welcome-*.{png,jpg}  (sources, several MB, NOT bundled)
 *        → src/assets/onboarding/welcome-*.webp  (≤ ~500 kB each, bundled)
 *
 * Run by `npm run assets`, which every build and dev start goes through, so the
 * optimised file is always present and never hand-made. The source PNG is kept
 * out of the app entirely: electron-builder only ships `dist/**` and
 * `dist-electron/**`, and Vite only emits what the renderer imports.
 *
 * Re-runnable and cheap: if the output is already newer than the source, it is
 * left alone. `--force` re-encodes it anyway.
 *
 * sharp is a devDependency and runs offline — no image service, no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const force = process.argv.includes('--force');

/** WebP is chosen over AVIF: at this size the saving is small and WebP
 *  decodes in a fraction of the time on a cold window. */
const QUALITY = 80;
/** The app's largest window is 1920px wide, so that is the width that matters;
 *  a 2560px encode would be ~30% more bytes for detail no window can show. */
const TARGET_WIDTH = 1920;
/** The task's budget for what the background may add to the installer. */
const BUDGET_BYTES = 500 * 1024;

const IMAGES = [
  {
    from: 'assets/onboarding/welcome-hills.jpg',
    to: 'src/assets/onboarding/welcome-hills.webp',
    purpose: 'the Welcome screen opening plate',
  },
  {
    from: 'assets/onboarding/welcome-forest.jpg',
    to: 'src/assets/onboarding/welcome-forest.webp',
    purpose: 'the Welcome screen second plate',
  },
  {
    from: 'assets/onboarding/welcome-bg.png',
    to: 'src/assets/onboarding/welcome-bg.webp',
    purpose: 'the Welcome screen knight plate',
  },
];

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('[images] sharp is not installed — run `npm install` (it is a devDependency).');
  process.exit(1);
}

let encoded = 0;
let skipped = 0;
let failed = 0;

for (const image of IMAGES) {
  const source = path.join(root, image.from);
  const target = path.join(root, image.to);

  if (!fs.existsSync(source)) {
    if (fs.existsSync(target)) {
      console.log(`[images] ${path.basename(target)} kept — the source PNG is not on this machine.`);
      skipped++;
      continue;
    }
    console.error(`[images] missing source: ${image.from} (needed for ${image.purpose})`);
    failed++;
    continue;
  }

  const sourceStat = fs.statSync(source);
  if (!force && fs.existsSync(target) && fs.statSync(target).mtimeMs >= sourceStat.mtimeMs) {
    const kb = (fs.statSync(target).size / 1024).toFixed(0);
    console.log(`[images] ${path.basename(target)} up to date (${kb} kB)`);
    skipped++;
    continue;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  const meta = await sharp(source).metadata();
  try {
    const info = await sharp(source)
      // Never upscale: a larger file would carry no extra detail, only bytes.
      .resize({ width: TARGET_WIDTH, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: QUALITY, effort: 5, smartSubsample: true })
      .toFile(target);
    const kb = (info.size / 1024).toFixed(0);
    const shrunk = (100 - (info.size / sourceStat.size) * 100).toFixed(1);
    console.log(
      `[images] ${path.basename(target)}  ${info.width}×${info.height}  ${kb} kB  ` +
        `(from ${(sourceStat.size / 1024).toFixed(0)} kB ${meta.format.toUpperCase()}, −${shrunk}%)`,
    );
    if (info.size > BUDGET_BYTES) {
      console.warn(
        `[images] ${path.basename(target)} is over the ${(BUDGET_BYTES / 1024).toFixed(0)} kB budget — lower QUALITY in scripts/optimise-images.mjs.`,
      );
    }
    encoded++;
  } catch (err) {
    console.error(`[images] failed to encode ${image.from}`, err);
    failed++;
  }
}

console.log(`[images] ${encoded} encoded, ${skipped} already current`);
if (failed) process.exit(1);

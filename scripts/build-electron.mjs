/**
 * Bundles the Electron side with esbuild — no TS build step, no plugin churn,
 * and identical behaviour on Windows, macOS and Linux.
 *
 *   dist-electron/main.js      (CJS, external: electron + electron-updater)
 *   dist-electron/preload.js   (CJS, sandbox-friendly)
 *   dist-electron/assets/*     (tray glyphs, toast icon)
 *
 * `node scripts/build-electron.mjs --watch` rebuilds and (in dev) the launcher
 * restarts Electron for you.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outdir = path.join(root, 'dist-electron');
const watch = process.argv.includes('--watch');

fs.mkdirSync(outdir, { recursive: true });

function copyAssets() {
  const from = path.join(root, 'electron', 'assets');
  const to = path.join(outdir, 'assets');
  if (!fs.existsSync(from)) {
    console.warn('[electron] electron/assets missing — run `npm run assets`');
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const file of fs.readdirSync(from)) {
    fs.copyFileSync(path.join(from, file), path.join(to, file));
  }
}

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
  },
  external: ['electron', 'electron-updater'],
};

const configs = [
  { ...shared, entryPoints: [path.join(root, 'electron', 'main.ts')], outfile: path.join(outdir, 'main.js') },
  { ...shared, entryPoints: [path.join(root, 'electron', 'preload.ts')], outfile: path.join(outdir, 'preload.js') },
];

if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  copyAssets();
  console.log('[electron] watching main.ts + preload.ts');
  // Keep the process alive for the watchers.
  await new Promise(() => {});
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  copyAssets();
  console.log('[electron] main.js + preload.js + assets → dist-electron');
}

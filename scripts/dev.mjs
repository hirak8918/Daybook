/**
 * One command (`npm run dev`) that works identically in PowerShell and cmd.exe:
 *
 *   1. starts the Vite dev server for the renderer
 *   2. bundles + watches the Electron main and preload scripts with esbuild
 *   3. launches Electron pointed at the dev server
 *   4. restarts Electron whenever the main process (or preload) rebuilds
 *
 * No concurrently/wait-on dependency, no bash-only syntax.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const electronBin = path.join(
  root,
  'node_modules',
  'electron',
  'dist',
  isWindows ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron',
);

let electron = null;
let restarting = false;
let shuttingDown = false;

function log(msg) {
  process.stdout.write(`\u001b[38;5;130m[daybook]\u001b[0m ${msg}\n`);
}

function startElectron(devServerUrl) {
  if (shuttingDown) return;
  electron = spawn(electronBin, ['.'], {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl, NODE_ENV: 'development' },
    stdio: 'inherit',
  });
  electron.on('exit', (code) => {
    if (restarting) return;
    log(`Electron exited (${code ?? 0}). Shutting the dev server down.`);
    shutdown();
  });
}

async function restartElectron(devServerUrl) {
  if (!electron || restarting || shuttingDown) return;
  restarting = true;
  log('main process changed — restarting Electron');
  const old = electron;
  electron = null;
  old.removeAllListeners('exit');
  old.kill();
  await new Promise((r) => setTimeout(r, 250));
  restarting = false;
  startElectron(devServerUrl);
}

function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`Vite did not answer at ${url}`));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    electron?.kill();
  } catch {
    /* already gone */
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!fs.existsSync(electronBin)) {
  console.error(`[daybook] Electron is not installed at ${electronBin}. Run: npm install`);
  process.exit(1);
}

const server = await createServer({ configFile: path.join(root, 'vite.config.ts') });
await server.listen();
const { port, https } = server.config.server;
const devServerUrl = `${https ? 'https' : 'http'}://127.0.0.1:${port}`;
log(`renderer dev server on ${devServerUrl}`);

await waitForServer(devServerUrl);
log('server up — building the Electron bundles');

const watcher = spawn(process.execPath, [path.join(__dirname, 'build-electron.mjs'), '--watch'], {
  cwd: root,
  stdio: 'inherit',
});

let mainBundleReady = false;
const bundlePath = path.join(root, 'dist-electron', 'main.js');
const waitForBundle = setInterval(async () => {
  if (!fs.existsSync(bundlePath)) return;
  if (!mainBundleReady) {
    mainBundleReady = true;
    clearInterval(waitForBundle);
    log('launching Electron');
    startElectron(devServerUrl);
    // Watch the bundle for rewrites from esbuild and restart Electron.
    fs.watch(path.dirname(bundlePath), (_event, filename) => {
      if (filename === 'main.js' || filename === 'preload.js') void restartElectron(devServerUrl);
    });
  }
}, 200);

setTimeout(() => {
  if (!mainBundleReady) {
    console.error('[daybook] timed out waiting for dist-electron/main.js');
    shutdown();
  }
}, 60_000);

watcher.on('exit', (code) => {
  if (!shuttingDown && code !== null) {
    console.error(`[daybook] esbuild watcher exited (${code})`);
    shutdown();
  }
});

/**
 * Dev-only inspector.
 *
 *   node scripts/inspect.mjs --eval "document.title"
 *   node scripts/inspect.mjs --shot build/shot.png
 *   node scripts/inspect.mjs --method Emulation.setDeviceMetricsOverride \
 *        --params '{"width":900,"height":600,"deviceScaleFactor":2,"mobile":false}'
 *
 * Drives a *running* Electron instance over the Chrome DevTools Protocol (the
 * app is started with `--remote-debugging-port=9222`). Node 22+ ships a global
 * WebSocket, so this needs no dependencies at all. It is a development tool:
 * nothing in the shipped app imports it, and it is not part of `npm run dist`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const readFlag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const port = Number(readFlag('--port') ?? 9222);
const expression = readFlag('--eval');
const shotPath = readFlag('--shot');
const waitMs = Number(readFlag('--wait') ?? 0);
const method = readFlag('--method');
const params = readFlag('--params');

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function targets() {
  const res = await fetchWithTimeout(`http://127.0.0.1:${port}/json`, 4000);
  if (!res.ok) throw new Error(`CDP endpoint answered ${res.status}`);
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    // Never let a silent target hang the one-shot tool.
    const connectTimer = setTimeout(() => reject(new Error(`websocket connect timed out after 6s: ${wsUrl}`)), 6000);
    const socket = new WebSocket(wsUrl);
    socket.addEventListener('open', () => clearTimeout(connectTimer), { once: true });
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => {
            // A vanished target must not hang the one-shot tool.
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`CDP ${method} timed out after 20s (target gone?)`));
            }, 20000);
            pending.set(id, {
              res: (value) => {
                clearTimeout(timer);
                res(value);
              },
              rej: (error) => {
                clearTimeout(timer);
                rej(error);
              },
            });
          });
        },
        close: () => socket.close(),
      }),
    );
    socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const { res, rej } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) rej(new Error(data.error.message));
        else res(data.result);
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(connectTimer);
      reject(new Error('websocket error'));
    });
  });
}

const list = await targets();
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!page) {
  console.error('No page target found. Is the app running with --remote-debugging-port=9222?');
  process.exit(1);
}

if (waitMs) await new Promise((r) => setTimeout(r, waitMs));

const client = await connect(page.webSocketDebuggerUrl);

if (method) {
  const result = await client.send(method, params ? JSON.parse(params) : {});
  console.log(JSON.stringify(result ?? null, null, 2));
}

if (expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    console.error('Evaluation threw:', JSON.stringify(result.exceptionDetails, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result.result.value, null, 2));
  }
}

if (shotPath) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const target = path.resolve(root, shotPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot → ${target}`);
}

client.close();
// The websocket keeps the event loop alive; this is a one-shot tool.
process.exit(process.exitCode ?? 0);

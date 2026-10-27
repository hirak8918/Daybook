/**
 * Test runner: bundles tests/run.ts (which imports the *real* shared modules)
 * with esbuild and executes it on Node. No test framework, no config drift, and
 * identical behaviour in PowerShell and cmd.exe.
 *
 *   npm test
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outfile = path.join(root, '.daybook-tests.mjs');

try {
  await esbuild.build({
    entryPoints: [path.join(root, 'tests', 'run.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    // ESM so the suite can use top-level await for the timer assertions.
    format: 'esm',
    target: 'node20',
    logLevel: 'error',
    external: ['electron'],
  });

  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit', cwd: root });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error('[test] build failed:', error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(outfile, { force: true });
}

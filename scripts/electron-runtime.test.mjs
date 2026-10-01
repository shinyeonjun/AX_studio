import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

test('actual installed Electron runs the synthetic transport and SQLite controls', { timeout: 60_000 }, () => {
  // RunAsNode does not launch a Chromium renderer or disable its sandbox. Never
  // inherit provider keys, user profiles, Python overrides or proxy hooks here.
  const electron = require('electron');
  // Keep bundled externals in core's actual workspace resolution scope.
  const cache = join(root, 'packages/core/node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(join(cache, 'electron-runtime-'));
  try {
    const outfile = join(scratch, 'controls.mjs');
    buildSync({
      entryPoints: [join(root, 'scripts/fixtures/electron-runtime-smoke.mjs')],
      outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm',
      logLevel: 'silent',
    });
    const env = {
      ELECTRON_RUN_AS_NODE: '1', HOME: scratch, USERPROFILE: scratch,
      TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      AX_ELECTRON_RUNTIME_SCRATCH: scratch, AX_ELECTRON_RUNTIME_ROOT: root,
      AX_ELECTRON_RUNTIME_EXPECTED: require('electron/package.json').version,
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
    };
    const result = spawnSync(electron, ['--test', outfile], {
      cwd: root, env, encoding: 'utf8', timeout: 50_000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    console.log(result.stdout.trim());
    if (result.stderr.trim()) console.log(result.stderr.trim());
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

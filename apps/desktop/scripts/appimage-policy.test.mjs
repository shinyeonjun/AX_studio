import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertAppImagePolicy, installOwnedAppRun, ownedAppRun } from './appimage-policy.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ax-appimage-test-'));
  const app = join(root, 'app with spaces');
  const bin = join(root, 'simulated-host');
  mkdirSync(app);
  mkdirSync(bin);
  const log = join(root, 'electron-invocations');
  function command(name, source) {
    const file = join(bin, name); writeFileSync(file, '#!/bin/sh\n' + source + '\n'); chmodSync(file, 0o755);
  }
  // These fixtures simulate branches only. They are never placed in a real
  // package or used to bypass the real host's namespace/sandbox restrictions.
  command('id', 'echo 1000');
  command('unshare', 'exit "${SIMULATED_PROBE_STATUS:-0}"');
  writeFileSync(join(app, 'ax-studio'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$TEST_LOG"\n');
  chmodSync(join(app, 'ax-studio'), 0o755);
  installOwnedAppRun({ electronPlatformName: 'linux', appOutDir: app });
  writeFileSync(join(app, 'ax-studio.desktop'), '[Desktop Entry]\nName=AX Studio\nExec=AppRun %U\nType=Application\n');
  return { root, app, bin, log, run(args = [], overrides = {}) {
    return spawnSync('/bin/sh', [join(app, 'AppRun'), ...args], { encoding: 'utf8', timeout: 5000,
      env: { PATH: bin + ':/usr/bin:/bin', APPDIR: app, TEST_LOG: log, ...overrides } });
  }, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test('afterPack is Linux-only and preserves the reviewed launcher bytes/mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-hook-test-'));
  try {
    installOwnedAppRun({ electronPlatformName: 'win32', appOutDir: root });
    assert.equal(existsSync(join(root, 'AppRun')), false);
    installOwnedAppRun({ electronPlatformName: 'linux', appOutDir: root });
    assert.deepEqual(readFileSync(join(root, 'AppRun')), readFileSync(ownedAppRun));
    if (process.platform !== 'win32') assert.equal(statSync(join(root, 'AppRun')).mode & 0o777, 0o755);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('the actual archive policy rejects stock/altered AppRun and unsafe desktop flags', () => {
  const f = fixture();
  try {
    assert.match(assertAppImagePolicy(f.app).exec, /^Exec=AppRun/);
    if (process.platform !== 'win32') {
      chmodSync(join(f.app, 'AppRun'), 0o644);
      assert.throws(() => assertAppImagePolicy(f.app), /regular executable file/);
      chmodSync(join(f.app, 'AppRun'), 0o755);
    }
    writeFileSync(join(f.app, 'ax-studio.desktop'), '[Desktop Entry]\nExec=AppRun --no-sandbox %U\n');
    assert.throws(() => assertAppImagePolicy(f.app), /desktop entry/);
    writeFileSync(join(f.app, 'AppRun'), '#!/bin/sh\nexec ax-studio --no-sandbox\n');
    assert.throws(() => assertAppImagePolicy(f.app), /reviewed project-owned/);
  } finally { f.cleanup(); }
});
test('simulated supported host forwards arguments exactly and never appends a bypass', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const result = f.run(['--user-data-dir=/isolated profile', 'a b']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(f.log, 'utf8'), '--user-data-dir=/isolated profile\na b\n');
  } finally { f.cleanup(); }
});
test('simulated namespace denial fails closed without starting Electron', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const result = f.run([], { SIMULATED_PROBE_STATUS: '1' });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /user namespaces.*unavailable/);
    assert.equal(existsSync(f.log), false);
  } finally { f.cleanup(); }
});
test('missing namespace probe utility fails closed', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    rmSync(join(f.bin, 'unshare'));
    // Minimal PATH deliberately has only id; it cannot find host unshare.
    const result = f.run([], { PATH: f.bin });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /user namespaces.*unavailable/);
    assert.equal(existsSync(f.log), false);
  } finally { f.cleanup(); }
});
test('root and explicit sandbox-disabling flags fail closed', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    for (const flag of ['--no-sandbox', '--no-sandbox=false', '--disable-setuid-sandbox', '--disable-seccomp-filter-sandbox', '--disable-gpu-sandbox', '--disable-namespace-sandbox', '--disable-landlock-sandbox', '--disable-webnn-compiler-sandbox', '--disable-namespace-sandbox=false']) {
      const result = f.run([flag]);
      assert.equal(result.status, 78, flag);
      assert.match(result.stderr, /Sandbox-disabling/);
      assert.equal(existsSync(f.log), false);
    }
    writeFileSync(join(f.bin, 'id'), '#!/bin/sh\necho 0\n');
    const result = f.run();
    assert.equal(result.status, 78);
    assert.match(result.stderr, /regular desktop user/);
    assert.equal(existsSync(f.log), false);
  } finally { f.cleanup(); }
});

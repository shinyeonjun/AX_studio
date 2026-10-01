import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep, win32 } from 'node:path';
import { test } from '@playwright/test';
import { fixtureRuntime, isolatedFixtureEnv } from '../lib/isolated-fixture-env.mjs';

test('fixture runtime isolates short Unix state, cleans up, and retains Windows evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-fixture-env-'));
  try {
    const unix = fixtureRuntime(join(root, 'deep', 'evidence'), { platform: 'linux', tempRoot: root });
    assert.ok(existsSync(unix.root));
    assert.equal(relative(root, unix.root).split(sep).length, 1);
    unix.cleanup();
    assert.equal(existsSync(unix.root), false);
    const windows = fixtureRuntime(root, { platform: 'win32', tempRoot: root });
    assert.equal(windows.root, root);
    windows.cleanup();
    assert.ok(existsSync(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fixture Linux environment preserves display transport and isolates all writable state', () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-fixture-env-'));
  try {
    const env = isolatedFixtureEnv(root, { platform: 'linux', env: {
      PATH: '/usr/bin:/bin', DISPLAY: ':123', XAUTHORITY: '/fixture-display-authority',
      WAYLAND_DISPLAY: 'wayland-1', XDG_RUNTIME_DIR: '/fixture-display-runtime',
      HOME: '/host-home', XDG_CONFIG_HOME: '/host-config', XDG_CACHE_HOME: '/host-cache',
      OPENAI_API_KEY: 'synthetic-unwanted', AWS_SECRET_ACCESS_KEY: 'synthetic-unwanted',
      GH_TOKEN: 'synthetic-unwanted', AX_DOCUMENT_ENGINE_PYTHON: '/host-python',
      AX_E2E_DOCUMENT_ENGINE: 'live', ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'https://fixture.invalid',
    } });
    for (const [key, value] of Object.entries({ DISPLAY: ':123', XAUTHORITY: '/fixture-display-authority',
      WAYLAND_DISPLAY: 'wayland-1', XDG_RUNTIME_DIR: '/fixture-display-runtime' })) assert.equal(env[key], value);
    for (const key of ['HOME', 'TEMP', 'TMP', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
      const path = relative(root, env[key]);
      assert.ok(!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
      assert.ok(existsSync(env[key]));
    }
    for (const key of ['OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'GH_TOKEN', 'AX_DOCUMENT_ENGINE_PYTHON',
      'AX_E2E_DOCUMENT_ENGINE', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'SYSTEMROOT', 'WINDIR']) assert.equal(env[key], undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fixture Windows environment retains existing profile and PATH policies', () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-fixture-env-'));
  try {
    const host = { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', Path: 'C:\\fixture-tools', DISPLAY: ':123', OPENAI_API_KEY: 'synthetic-unwanted' };
    const profile = join(root, 'profile');
    const temp = join(root, 'temp');
    const env = isolatedFixtureEnv(root, { platform: 'win32', env: host, homeDir: profile, tempDir: temp });
    assert.equal(env.PATH, host.Path);
    assert.equal(env.SYSTEMROOT, host.SystemRoot);
    assert.equal(env.WINDIR, host.WINDIR);
    assert.equal(env.USERPROFILE, profile);
    assert.equal(env.TEMP, temp);
    assert.equal(env.TMP, temp);
    assert.equal(env.APPDATA, join(root, 'roaming'));
    assert.equal(env.LOCALAPPDATA, join(root, 'local'));
    assert.equal(env.DISPLAY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    const system = isolatedFixtureEnv(root, { platform: 'win32', env: host, windowsPath: 'system32' });
    assert.equal(system.PATH, win32.join(host.SystemRoot, 'System32'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

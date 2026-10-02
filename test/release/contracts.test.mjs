import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { runnerContext, DISPOSABLE_MARKER, assertInside, windowsPath, assertNoReparse, isolatedAppEnvironment } from './runner-safety.mjs';
import { assertPeMetadata, readManifest, sha256, verifyFile, verifyInstalled, fileInventory } from './verify-assets.mjs';
import { assertUpgradeObservation, assertProcessedPdfSource, CALCULATED_OUTPUT, TAIL_MESSAGES } from './acceptance-contract.mjs';

const runnerEnv = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows', RUNNER_ARCH: 'X64',
  AX_INSTALLER_DISPOSABLE: DISPOSABLE_MARKER, GITHUB_REPOSITORY: 'shinyeonjun/AX_studio', GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'installer', USERPROFILE: 'C:\\Users\\runneradmin',
  LOCALAPPDATA: 'C:\\Users\\runneradmin\\AppData\\Local', APPDATA: 'C:\\Users\\runneradmin\\AppData\\Roaming',
  RUNNER_TEMP: 'D:\\a\\_temp', GITHUB_WORKSPACE: 'D:\\a\\AX_studio\\AX_studio' };

test('runner execution requires every independent hosted/disposable identity guard', () => {
  const context = runnerContext(runnerEnv, 'runneradmin', 'win32');
  assert.equal(context.install, 'D:\\a\\_temp\\ax-installer-42-1-installer\\program');
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_OS: 'Linux',
    RUNNER_ARCH: 'ARM64', AX_INSTALLER_DISPOSABLE: '', GITHUB_REPOSITORY: 'someone/another', GITHUB_SHA: 'main',
    GITHUB_RUN_ID: '', GITHUB_RUN_ATTEMPT: '0', GITHUB_JOB: '../other', USERPROFILE: 'C:\\Users\\existing-user',
    LOCALAPPDATA: 'C:\\Users\\another\\AppData\\Local', APPDATA: 'C:\\Users\\another\\AppData\\Roaming',
    RUNNER_TEMP: 'C:\\Users\\runneradmin\\_temp', GITHUB_WORKSPACE: 'C:\\existing-checkout' })) {
    assert.throws(() => runnerContext({ ...runnerEnv, [key]: value }, 'runneradmin', 'win32'), key);
  }
  assert.throws(() => runnerContext(runnerEnv, 'existing-user', 'win32'), /user account/);
  assert.throws(() => runnerContext(runnerEnv, 'runneradmin', 'linux'), /Windows/);
});

test('target boundary rejects sibling prefixes, drive-relative paths, UNC/device paths, traversal and ADS', () => {
  const root = 'D:\\a\\_temp\\owned';
  assert.equal(assertInside(root, root + '\\program'), root + '\\program');
  for (const path of [root, root + '-sibling\\program', 'C:\\program', root + '\\..\\user',
    'D:program', '\\\\server\\share', '\\\\?\\D:\\program', root + '\\program:stream', root + '\\*.exe']) {
    assert.throws(() => assertInside(root, path), path);
  }
  assert.equal(windowsPath('C:\\'), 'C:\\');
});

test('app environment removes real credentials, developer seams and Python overrides; all data paths are synthetic', () => {
  const workspace = 'D:\\a\\_temp\\owned\\acceptance';
  const env = isolatedAppEnvironment({ PATH: 'runtime-path', SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'private',
    GOOGLE_OAUTH_CLIENT_SECRET: 'private', AX_E2E: '1', AX_PRODUCT_QA: '1', AX_DOCUMENT_ENGINE_PYTHON: 'host-python',
    NODE_OPTIONS: '--require private.js', PYTHONPATH: 'host-packages', HOME: 'user-home', LOCALAPPDATA: 'user-data' }, workspace);
  assert.equal(env.PATH, 'runtime-path');
  for (const key of ['OPENAI_API_KEY', 'GOOGLE_OAUTH_CLIENT_SECRET', 'AX_E2E', 'AX_PRODUCT_QA', 'AX_DOCUMENT_ENGINE_PYTHON', 'NODE_OPTIONS', 'PYTHONPATH']) assert.equal(env[key], undefined);
  for (const key of ['AX_DATA_ROOT', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) assertInside(workspace, env[key]);
});

test('local dry-run never creates a disposable marker or launches a process', () => {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'runner-safety.mjs'), '--dry-run'],
    { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' }, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.allowed, false); assert.equal(output.execution, false);
  assert(!output.root);
});

test('missing explicit disposable opt-in cannot initialize a marker, including with workflow-like variables', () => {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'runner-safety.mjs'), '--initialize'],
    { encoding: 'utf8', env: { ...process.env, ...runnerEnv, AX_INSTALLER_DISPOSABLE: '' }, windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, process.platform === 'win32' ? /AX_INSTALLER_DISPOSABLE/ : /Windows/);
  assert(!existsSync(win32.join(runnerEnv.RUNNER_TEMP, 'ax-installer-42-1-installer', 'disposable-runner.json')));
});

test('PE identity keeps exact prerelease FileVersion and app numeric ProductVersion', () => {
  const version = '0.1.0-preview.1';
  const app = { productName: 'AX Studio', productVersion: '0.1.0.0', fileVersion: version, signature: 'NotSigned' };
  assertPeMetadata(app, 'app', version);
  assertPeMetadata({ ...app, productVersion: version }, 'installer', version);
  for (const changes of [{ productName: 'Electron' }, { fileVersion: '0.1.0.0' }, { productVersion: '44.5.1' }, { signature: 'HashMismatch' }]) {
    assert.throws(() => assertPeMetadata({ ...app, ...changes }, 'app', version));
  }
  assertPeMetadata({ ...app, fileVersion: '0.1.0.0' }, 'app', '0.1.0');
});

const scratch = resolve(import.meta.dirname, 'runs', 'contracts-' + randomUUID());
mkdirSync(scratch, { recursive: true }); // Owned source-test evidence, never an installed app/profile.

test('artifact hash and size reject alteration, even with a matching filename/version', () => {
  const file = join(scratch, 'synthetic-asset.bin'); writeFileSync(file, 'synthetic artifact');
  const expected = { sha256: sha256(file), size: readFileSync(file).length };
  verifyFile(file, expected);
  writeFileSync(file, 'synthetic artifacX'); assert.throws(() => verifyFile(file, expected), /checksum/);
  writeFileSync(file, 'short'); assert.throws(() => verifyFile(file, expected), /size/);
});

test('manifest requires exact source/version, exact assets and installed PDF payload', () => {
  const file = join(scratch, 'manifest.json');
  const manifest = { schemaVersion: 1, appId: 'com.axstudio.desktop', sourceSha: 'a'.repeat(40), version: '0.1.0',
    assets: { 'AX Studio Setup 0.1.0.exe': {}, 'AX Studio Setup 0.1.0.exe.blockmap': {} }, payload: {
      'AX Studio.exe': {}, 'resources/app.asar': {}, 'resources/document-engine/python/python.exe': {}, 'resources/document-engine/src/worker.py': {} } };
  const read = value => { writeFileSync(file, JSON.stringify(value)); return readManifest(file, 'a'.repeat(40), '0.1.0'); };
  read(manifest);
  assert.throws(() => read({ ...manifest, sourceSha: 'b'.repeat(40) }), /source/);
  assert.throws(() => read({ ...manifest, version: '0.1.0-preview.1' }), /version/);
  assert.throws(() => read({ ...manifest, assets: { '../other.exe': {} } }));
  assert.throws(() => read({ ...manifest, payload: { 'AX Studio.exe': {}, 'resources/app.asar': {} } }), /PDF/);
  assert.throws(() => verifyInstalled(scratch, { payload: { '../outside.exe': {} } }), /Unsafe/);
});

test('real filesystem inventory rejects reparse ancestors and catches deletion/byte changes', () => {
  const data = join(scratch, 'data'); mkdirSync(data);
  const file = join(data, 'synthetic.db'); writeFileSync(file, 'synthetic database bytes');
  const before = fileInventory(data);
  assert.deepEqual(fileInventory(data), before);
  writeFileSync(file, 'different database bytes'); assert.notDeepEqual(fileInventory(data), before);
  const link = join(scratch, 'redirect'); symlinkSync(data, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertNoReparse(join(link, 'synthetic.db')), /Reparse|resolves/);
  assert.equal(readFileSync(file, 'utf8'), 'different database bytes');
});

test('upgrade requires raw retention AND Store, lazy IPC and rendered calculated output', () => {
  const logs = Object.fromEntries(Object.entries(TAIL_MESSAGES).map(([kind, message]) => [kind, [{ message }]]));
  const valid = { producer: { sourceSha: '0ba5e22f54cc9fe2bb777f085290bb03de5f457b', version: '0.1.0-preview.1', installedAppPersisted: true },
    rawPreserved: true, getExecution: { output: CALCULATED_OUTPUT, ...logs }, listExecutions: { output: CALCULATED_OUTPUT, ...logs },
    hasOutput: true, ipcOutput: CALCULATED_OUTPUT, renderedOutput: '731', pendingTailVisible: true };
  assertUpgradeObservation(valid);
  for (const changes of [{ rawPreserved: false }, { hasOutput: false }, { ipcOutput: undefined }, { renderedOutput: null },
    { pendingTailVisible: false }, { producer: { ...valid.producer, installedAppPersisted: false } },
    { getExecution: { ...valid.getExecution, output: undefined } }, { listExecutions: { ...valid.listExecutions, pending: [] } }]) {
    assert.throws(() => assertUpgradeObservation({ ...valid, ...changes }));
  }
  const observedCurrentRegression = { ...valid, getExecution: { output: undefined, interrupted: [], pending: [] },
    listExecutions: { output: undefined, interrupted: [], pending: [] }, hasOutput: undefined, ipcOutput: undefined, renderedOutput: null };
  assert.throws(() => assertUpgradeObservation(observedCurrentRegression), /lost output_json/);
});

test('PDF acceptance requires completed real ingestion and extracted text, never just an attached or queued file', () => {
  const source = { status: 'ready', engine: 'basic', documentArtifactId: 'synthetic-doc', summary: { pageCount: 1, chunkCount: 1 } };
  const document = { text: 'AX installed synthetic PDF' };
  assertProcessedPdfSource(source, document);
  for (const changes of [{ status: 'processing' }, { status: 'failed' }, { engine: 'mock' },
    { documentArtifactId: undefined }, { summary: { pageCount: 1, chunkCount: 0 } }]) {
    assert.throws(() => assertProcessedPdfSource({ ...source, ...changes }, document));
  }
  assert.throws(() => assertProcessedPdfSource(source, { text: 'wrong parsed content' }));
});

test('every release Electron launcher explicitly enables Chromium sandbox, including future launchers', () => {
  function assertSandboxedLaunches(source, file) {
    const calls = [...source.matchAll(/\belectron\.launch\s*\(/g)];
    const options = [...source.matchAll(/\belectron\.launch\s*\(\s*\{([\s\S]*?)\}\s*\)/g)];
    assert.equal(options.length, calls.length, `${file}: launcher options must be explicit for review`);
    for (const [, body] of options) {
      const settings = [...body.matchAll(/\bchromiumSandbox\s*:\s*([^,}\s]+)/g)];
      assert.equal(settings.length, 1, `${file}: exactly one chromiumSandbox option is required`);
      assert.equal(settings[0][1], 'true', `${file}: Chromium sandbox must be enabled`);
    }
    return calls.length;
  }
  let launches = 0;
  for (const file of readdirSync(import.meta.dirname).filter(file => file.endsWith('.mjs') && !file.endsWith('.test.mjs'))) {
    const source = readFileSync(join(import.meta.dirname, file), 'utf8');
    const count = assertSandboxedLaunches(source, file);
    launches += count;
    if (count) {
      assert.throws(() => assertSandboxedLaunches(source.replace(/chromiumSandbox\s*:\s*true\s*,?/g, ''), file), /chromiumSandbox/);
      assert.throws(() => assertSandboxedLaunches(source.replace(/chromiumSandbox\s*:\s*true/g, 'chromiumSandbox: false'), file), /sandbox must be enabled/);
    }
  }
  assert(launches >= 2, 'Both installed-app and clean-startup launchers must be covered');
});

test('installer source keeps guard ahead of side effects and exposes only a source-only dry-run escape', () => {
  const source = readFileSync(join(import.meta.dirname, 'windows-installer.ps1'), 'utf8');
  assert(!/AllowHostInstall|ExecutionPolicy\s+Bypass|Remove-Item|reg\.exe|--no-sandbox|skip-ui|continue-on-error/i.test(source));
  assert(source.indexOf('$contextJson = & node $guard') < source.indexOf('Start-Process'));
  assert(source.includes('installer_exit_confirmed'));
  const app = readFileSync(join(import.meta.dirname, 'installed-app.mjs'), 'utf8');
  assert(!/ipcMain\.removeHandler|ipcMain\.handle|fakeAgent\s*[:=]|AX_E2E\s*[:=]|AX_PRODUCT_QA\s*[:=]/.test(app));
  assert(app.indexOf('assertRunner(') < app.indexOf('electron.launch('));
  const clean = readFileSync(join(import.meta.dirname, 'clean-startup.mjs'), 'utf8');
  assert(clean.indexOf('assertRunner(') < clean.indexOf('electron.launch('));
  assert(!/AX_E2E\s*[:=]|AX_PRODUCT_QA\s*[:=]|fakeAgent\s*[:=]/.test(clean));
});

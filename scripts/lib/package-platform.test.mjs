import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, realpathSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assertNativeBuildHost, copyBundle, isolatedAppEnv, isolatedPythonEnv, packagePaths, packagePlatform, parsePackageArgs, pythonRuntimes, verifyArchiveBytes } from './package-platform.mjs';

test('Windows packaging layout retains the original executable, embed runtime and directory', () => {
  const layout = packagePaths('/package', 'win32', 'x64');
  assert.equal(layout.unpacked, 'win-unpacked');
  assert.equal(layout.executablePath, join('/package', 'AX Studio.exe'));
  assert.equal(layout.python, 'python/python.exe');
  assert.equal(layout.sitePackages, 'python/Lib/site-packages');
  assert.equal(layout.pythonLicense, 'python/LICENSE.txt');
  assert.equal(pythonRuntimes.win32.sha256, 'd1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf');
});
test('Linux packaging uses a portable runtime, Linux directory and explicit executable identity', () => {
  const layout = packagePaths('/package', 'linux', 'x64');
  assert.equal(layout.unpacked, 'linux-unpacked');
  assert.equal(layout.executablePath, join('/package', 'ax-studio'));
  assert.equal(layout.python, 'python/bin/python3');
  assert.match(layout.sitePackages, /python3\.13\/site-packages$/);
  assert.match(pythonRuntimes.linux.url, /20260901\/.*install_only_stripped\.tar\.gz$/);
  assert.match(pythonRuntimes.linux.noticesUrl, /pgo%2Blto-full\.tar\.zst$/);
});
test('unsupported platforms, architectures and cross-packaging fail closed', () => {
  assert.throws(() => packagePlatform('darwin', 'x64'), /native Windows x64 and Linux/);
  assert.throws(() => packagePlatform('linux', 'arm64'), /native Windows x64 and Linux/);
  assert.throws(() => parsePackageArgs(['--platform=win32'], 'linux', 'x64'), /cross-packaging/);
  assert.throws(() => parsePackageArgs(['--publish=always'], 'linux', 'x64'), /Unknown/);
});
test('checksum verification rejects even one altered byte', () => {
  const bytes = Buffer.from('upstream runtime');
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifyArchiveBytes(bytes, hash), hash);
  assert.throws(() => verifyArchiveBytes(Buffer.from('upstream runtimf'), hash), /checksum mismatch/);
});
test('Python acceptance has no host PATH, Python environment or user site', () => {
  const env = isolatedPythonEnv('/scratch', { PATH: '/host', PYTHONPATH: '/checkout', PYTHONHOME: '/host', SystemRoot: 'C:\\Windows' }, 'linux');
  assert.equal(env.PATH, undefined);
  assert.equal(env.PYTHONPATH, undefined);
  assert.equal(env.PYTHONHOME, undefined);
  assert.equal(env.SystemRoot, undefined);
  assert.equal(env.HOME, '/scratch');
  assert.equal(isolatedPythonEnv('/scratch', { SystemRoot: 'C:\\Windows' }, 'win32').SystemRoot, 'C:\\Windows');
});
test('UI smoke isolates profiles and strips provider keys and inherited test overrides', () => {
  const env = isolatedAppEnv('/scratch', { DISPLAY: ':0', PATH: '/bin', AX_DOCUMENT_ENGINE_PYTHON: '/host/python', AX_E2E_DOCUMENT_ENGINE: 'fake',
    OPENAI_API_KEY: 'test-only-not-a-key', PYTHONPATH: '/checkout', ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'http://dev' });
  assert.equal(env.DISPLAY, ':0');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.AX_DOCUMENT_ENGINE_PYTHON, undefined);
  assert.equal(env.AX_E2E_DOCUMENT_ENGINE, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.PYTHONPATH, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.ELECTRON_RENDERER_URL, undefined);
  assert.equal(env.AX_DATA_ROOT, join('/scratch', 'data'));
  assert.equal(env.HOME, '/scratch');
  assert.equal(env.AX_E2E_FAKE_AGENT, '1');
});
test('headless verification is an explicit option, never a silent GUI pass', () => {
  assert.equal(parsePackageArgs([], 'linux', 'x64').skipUi, false);
  assert.equal(parsePackageArgs(['--skip-ui', '--dir'], 'linux', 'x64').skipUi, true);
  assert.equal(parsePackageArgs(['--platform=win32'], 'win32', 'x64').builderFlag, '--win');
});

test('relocating a Linux bundle preserves relative executable symlinks', { skip: process.platform === 'win32' }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ax-copy-test-'));
  try {
    const source = join(scratch, 'staging');
    const target = join(scratch, 'relocated payload 한글');
    mkdirSync(join(source, 'python/bin'), { recursive: true });
    writeFileSync(join(source, 'python/bin/python3.13'), 'fixture executable');
    symlinkSync('python3.13', join(source, 'python/bin/python3'));
    copyBundle(source, target);
    rmSync(source, { recursive: true, force: true });
    assert.equal(readlinkSync(join(target, 'python/bin/python3')), 'python3.13');
    assert.equal(realpathSync(join(target, 'python/bin/python3')), join(target, 'python/bin/python3.13'));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('Linux build host validation rejects musl before downloading or changing outputs', () => {
  const linux = packagePlatform('linux', 'x64');
  assert.throws(() => assertNativeBuildHost(linux, { platform: 'linux', arch: 'x64', glibcVersion: undefined }), /glibc.*musl/);
  assert.doesNotThrow(() => assertNativeBuildHost(linux, { platform: 'linux', arch: 'x64', glibcVersion: '2.41' }));
  assert.throws(() => assertNativeBuildHost(linux, { platform: 'linux', arch: 'arm64', glibcVersion: '2.41' }), /matching native/);
  assert.doesNotThrow(() => assertNativeBuildHost(packagePlatform('win32', 'x64'), { platform: 'win32', arch: 'x64' }));
});

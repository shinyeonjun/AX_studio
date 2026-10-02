// Preserve pinned product sources; never invoke their old pack:win UI verifier.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertElectronSandbox } from '../../scripts/lib/electron-sandbox.mjs';
import { assertRunner, assertNoReparse, isolatedAppEnvironment, denyRendererHttp, PREVIEW_SHA, PREVIEW_VERSION } from './runner-safety.mjs';

export const PREVIEW_CORE_FILES = ['persistence/db/sqljs.js', 'persistence/workflow-store.js', 'persistence/artifact-store.js'];
export function assertPreviewCoreReady(repo) {
  for (const file of PREVIEW_CORE_FILES) {
    const path = join(repo, 'packages/core/dist', file);
    assertNoReparse(path);
    assert(existsSync(path) && readFileSync(path).length > 0, 'Build pinned preview Core before packaging: ' + file);
  }
}

// The legacy helper's Python-only branches retain all its native/font/form/worker
// checks. Its Electron --verify-package branch is deliberately unreachable here.
export function previewDocumentArguments(mode, bundle) {
  assert(['--bundle', '--verify-bundle'].includes(mode), 'Pinned preview Electron verification is forbidden');
  assert(mode === '--bundle' ? bundle === undefined : typeof bundle === 'string' && bundle.length > 0);
  return mode === '--bundle' ? [mode] : [mode, bundle];
}

export function verifyPreviewArchive(asar, archive) {
  function visit(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const relative = join(prefix, name);
      if (entry.files) visit(entry, relative);
      else if (!entry.link && entry.integrity) {
        const hash = createHash('sha256').update(asar.extractFile(archive, relative)).digest('hex');
        assert.equal(hash, entry.integrity.hash, 'Packaged file integrity mismatch: ' + relative);
      }
    }
  }
  visit(asar.getRawHeader(archive).header);
  for (const relative of ['node_modules/react/LICENSE', 'node_modules/@ai-sdk/provider/LICENSE']) {
    assert(asar.extractFile(archive, join(...relative.split('/'))).length >= 100, 'Missing archived license notice: ' + relative);
  }
}

async function buildPreview(repo) {
  const context = assertRunner({ paths: [repo] });
  assert.equal(repo, join(context.workspace, 'preview'), 'Only the immutable preview checkout is allowed');
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
  const assertPinnedSource = () => {
    assert.equal(git(['rev-parse', 'HEAD']).trim(), PREVIEW_SHA);
    git(['diff', '--exit-code', 'HEAD', '--']);
  };
  assertPinnedSource();
  assertPreviewCoreReady(repo);
  const desktop = JSON.parse(readFileSync(join(repo, 'apps/desktop/package.json'), 'utf8'));
  const core = JSON.parse(readFileSync(join(repo, 'packages/core/package.json'), 'utf8'));
  assert.equal(desktop.version, PREVIEW_VERSION); assert.equal(core.version, PREVIEW_VERSION);
  assert.equal(desktop.scripts.build, 'electron-vite build');
  assert.equal(core.scripts.build, 'node scripts/embed-skills.mjs && tsc');
  for (const pkg of [desktop, core]) assert(!pkg.scripts.prebuild && !pkg.scripts.postbuild, 'Unreviewed nested build hook');
  const workspace = join(context.root, 'preview package 한글');
  const env = isolatedAppEnvironment(process.env, workspace);
  assertRunner({ paths: [workspace] });
  assert(!existsSync(workspace), 'Preview verification workspace must be new');
  for (const path of [workspace, env.HOME, env.APPDATA, env.LOCALAPPDATA, env.TEMP]) mkdirSync(path, { recursive: true });
  const venv = join(repo, 'packages/document-engine/.venv');
  assertRunner({ paths: [venv] });
  assert(!existsSync(venv), 'Do not reuse a preview build venv');
  const requirePreview = createRequire(join(repo, 'package.json'));
  function run(command, args, cwd = repo) {
    assertRunner({ paths: [repo, cwd, workspace, venv] });
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true,
      shell: process.platform === 'win32' && command === 'npm', timeout: 1_200_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Preview build/check failed: ' + args.join(' '));
  }
  // Package installs use only this venv; the old bundle command selects it first.
  run('python', ['-m', 'venv', venv]);
  assert(existsSync(join(venv, 'Scripts/python.exe')), 'Preview build venv is missing');
  run(process.execPath, [requirePreview.resolve('electron/install.js')]);
  const legacyDocumentHelper = join(repo, 'scripts/document-engine-install.mjs');
  run(process.execPath, [legacyDocumentHelper, ...previewDocumentArguments('--bundle')]);
  run('npm', ['run', 'build', '-w', '@ax-studio/desktop']);
  run(process.execPath, [requirePreview.resolve('electron-builder/cli.js'), '--win', '--x64', '--publish', 'never'], join(repo, 'apps/desktop'));
  assertPinnedSource();

  const directory = join(repo, 'apps/desktop/release/win-unpacked');
  const executable = join(directory, 'AX Studio.exe');
  const archive = join(directory, 'resources/app.asar');
  assertRunner({ paths: [directory, executable, archive] });
  const report = { schemaVersion: 1, sourceSha: PREVIEW_SHA, version: PREVIEW_VERSION, passed: false, checks: [] };
  let app;
  let network;
  try {
    verifyPreviewArchive(requirePreview('@electron/asar'), archive);
    for (const relative of ['LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources/LICENSE.AX-Studio.txt',
      'resources/THIRD_PARTY_NOTICES.md', 'resources/document-engine/python/LICENSE.txt']) {
      const path = join(directory, relative); assertNoReparse(path);
      assert(readFileSync(path).length >= 100, 'Missing packaged license notice: ' + relative);
    }
    report.checks.push('archive integrity and complete historical license notices');
    run(process.execPath, [legacyDocumentHelper, ...previewDocumentArguments('--verify-bundle', join(directory, 'resources/document-engine'))]);
    report.checks.push('historical bundled native imports, font/license/hash, Korean forms, source preservation and worker ingestion');
    const { _electron: electron } = await import('@playwright/test');
    const profile = join(workspace, 'electron profile 한글');
    assertRunner({ paths: [executable, profile] });
    app = await electron.launch({ executablePath: executable, chromiumSandbox: true,
      args: [`--user-data-dir=${profile}`], cwd: workspace, env, timeout: 60_000 });
    network = await denyRendererHttp(app.context());
    report.networkBoundary = { scope: 'renderer HTTP(S) after context creation', blocked: network.blocked, processIsolation: false };
    await assertElectronSandbox(app);
    const page = await app.firstWindow({ timeout: 60_000 });
    await page.getByRole('button', { name: '새 대화', exact: true }).waitFor({ timeout: 60_000 });
    const identity = await app.evaluate(({ app, safeStorage }) => ({ packaged: app.isPackaged, version: app.getVersion(),
      encrypted: safeStorage.isEncryptionAvailable(), profile: app.getPath('userData'), root: process.env.AX_DATA_ROOT,
      seams: Object.keys(process.env).filter(key => /^(AX_E2E|AX_PRODUCT_QA|AX_POC|AX_FAKE|NODE_OPTIONS)/.test(key)),
      unsafeFlags: process.argv.filter(arg => /no-sandbox|disable.*sandbox|fake.?agent/i.test(arg)) }));
    assert.equal(identity.packaged, true); assert.equal(identity.version, PREVIEW_VERSION); assert.equal(identity.encrypted, true);
    assert.equal(identity.profile, profile); assert.equal(identity.root, env.AX_DATA_ROOT);
    assert.deepEqual(identity.seams, []); assert.deepEqual(identity.unsafeFlags, []);
    report.identity = identity; report.checks.push('real sandboxed packaged startup without seams');
    await page.screenshot({ path: join(context.root, 'preview-package.png') });
    assertPinnedSource(); report.passed = true;
  } catch (error) { report.error = error.message; process.exitCode = 1; }
  finally {
    try { if (app) await app.close(); }
    catch (error) { report.passed = false; report.closeError = error.message; process.exitCode = 1; }
    try { network?.assertUnused(); }
    catch (error) { report.passed = false; report.networkError = error.message; process.exitCode = 1; }
    assertRunner({ paths: [workspace] });
    writeFileSync(join(context.root, 'preview-package.json'), JSON.stringify(report, null, 2));
  }
  console.log('[preview-package] passed=' + report.passed);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { repo: { type: 'string' } } });
  try { assert(values.repo); await buildPreview(resolve(values.repo)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

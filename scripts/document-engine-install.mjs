import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertNativeBuildHost, copyBundle, isolatedAppEnv, isolatedPythonEnv, packagePaths, packagePlatform, pythonRuntimes, verifyArchiveBytes } from './lib/package-platform.mjs';

const root = join(import.meta.dirname, '..');
const engineRoot = join(root, 'packages', 'document-engine');
const venvDir = join(engineRoot, '.venv');
const python = process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python');
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return resolve(value);
}
function requiredFile(path) {
  if (!existsSync(path) || readFileSync(path).length < 100) throw new Error(`Missing or empty packaged notice: ${path}`);
}

function verifyBundle(bundle) {
  const layout = packagePlatform();
  const manifest = JSON.parse(readFileSync(join(bundle, 'bundle-manifest.json'), 'utf8'));
  if (manifest.platform !== layout.platform || manifest.arch !== layout.arch || manifest.schema !== 1 || manifest.python.version !== pythonRuntimes[layout.platform].version ||
    manifest.python.sha256 !== pythonRuntimes[layout.platform].sha256 || manifest.python.url !== pythonRuntimes[layout.platform].url) {
    throw new Error('Document bundle platform, architecture or Python version mismatch');
  }
  const requirementsHash = createHash('sha256').update(readFileSync(join(bundle, 'requirements.txt'))).digest('hex');
  if (requirementsHash !== manifest.requirementsSha256) throw new Error('Bundled requirements differ from bundle manifest');
  requiredFile(join(bundle, layout.pythonLicense));
  if (layout.platform === 'linux') {
    const notices = join(bundle, 'python', 'runtime-notices');
    const upstream = JSON.parse(readFileSync(join(notices, 'PYTHON.json'), 'utf8'));
    if (upstream.target_triple !== 'x86_64-unknown-linux-gnu' || upstream.python_version !== manifest.python.version) {
      throw new Error('Linux runtime metadata does not match the pinned runtime');
    }
    requiredFile(join(notices, upstream.license_path));
    requiredFile(join(notices, 'licenses', 'LICENSE.openssl-3.txt'));
  }
  const scratch = mkdtempSync(join(tmpdir(), 'ax-document-smoke-'));
  try {
    // Relocate the complete payload to a Unicode/spaced path. No PATH, Python env,
    // user site, checkout cwd, host interpreter, or developer venv at runtime.
    const relocated = join(scratch, 'relocated payload 한글');
    copyBundle(bundle, relocated);
    const executable = join(relocated, layout.python);
    if (!existsSync(executable)) throw new Error(`Missing bundled interpreter: ${executable}`);
    const runtime = join(relocated, 'python');
    const cwd = join(scratch, 'empty-cwd');
    mkdirSync(cwd);
    const options = { cwd, windowsHide: true, encoding: 'utf8', timeout: 120_000,
      env: isolatedPythonEnv(scratch) };
    const evidence = JSON.parse(execFileSync(executable, ['-E', '-s', join(root, 'scripts/document-engine-smoke.py'), runtime, scratch], options));
    const response = JSON.parse(execFileSync(executable, ['-E', '-s', join(relocated, 'src', 'worker.py')], {
      ...options, input: JSON.stringify({ id: 'package-smoke', command: 'ingest', params: {
        path: evidence.pdf, artifactRoot: join(scratch, 'artifacts'), allowedPaths: [evidence.pdf],
        allowedRoots: [join(scratch, 'artifacts')], options: { engine: 'basic' },
      } }),
    }));
    if (!response.ok || !JSON.stringify(response.data).includes('AX packaged document smoke')) {
      throw new Error('Packaged PDF ingestion failed: ' + JSON.stringify(response));
    }
    console.log('Packaged document engine: relocated Python, native PDF rendering, OpenCV and worker ingestion passed.');
    console.log('Packaged dependency versions: ' + JSON.stringify(evidence.distributions));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

async function verifyPackage(directory, { skipUi = false } = {}) {
  const layout = packagePaths(directory);
  if (!existsSync(layout.executablePath)) throw new Error('Missing packaged application executable: ' + layout.executablePath);
  const asar = await import('@electron/asar');
  function verifyFiles(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const relative = join(prefix, name);
      if (entry.files) verifyFiles(entry, relative);
      else if (!entry.link && entry.integrity) {
        const hash = createHash('sha256').update(asar.extractFile(layout.archive, relative)).digest('hex');
        if (hash !== entry.integrity.hash) throw new Error('Packaged file integrity mismatch: ' + relative);
      }
    }
  }
  verifyFiles(asar.getRawHeader(layout.archive).header);
  for (const relative of ['LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources/PACKAGING_NOTICES.md']) {
    requiredFile(join(directory, relative));
  }
  // Do not invent a license for branches lacking one. Existing project notices
  // must survive packaging when configured; final distribution review is separate.
  for (const [source, target] of [['LICENSE', 'LICENSE.AX-Studio.txt'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']]) {
    if (existsSync(join(root, source))) requiredFile(join(directory, 'resources', target));
  }
  for (const relative of ['node_modules/react/LICENSE', 'node_modules/@ai-sdk/provider/LICENSE']) {
    if (asar.extractFile(layout.archive, relative).length < 100) throw new Error('Missing archived dependency notice: ' + relative);
  }
  verifyBundle(layout.bundle);
  console.log('Packaged archive integrity and runtime notice presence passed. Distribution/license approval remains separate.');
  if (skipUi) {
    console.log('Packaged graphical startup: NOT VERIFIED (--skip-ui explicitly selected).');
    return;
  }
  if (layout.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error('Linux graphical verification needs a desktop display or xvfb-run. The package was built, but UI startup has NOT passed. Use --skip-ui only for explicit headless payload checks.');
  }
  const { _electron } = await import('@playwright/test');
  const scratch = mkdtempSync(join(tmpdir(), 'ax-package-ui-'));
  let app;
  try {
    app = await _electron.launch({ executablePath: layout.executablePath,
      args: ['--user-data-dir=' + join(scratch, 'profile')], cwd: scratch, env: isolatedAppEnv(scratch), timeout: 60_000 });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '새 대화', exact: true }).waitFor({ timeout: 30_000 });
    if (!await app.evaluate(({ app }) => app.isPackaged)) throw new Error('Expected packaged application');
    console.log('Packaged app: isolated graphical startup passed.');
  } finally {
    if (app) await app.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function archiveBytes(url, checksum, localPath) {
  let archive;
  if (localPath) archive = readFileSync(localPath);
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error('Python download failed: HTTP ' + response.status);
    archive = Buffer.from(await response.arrayBuffer());
  }
  verifyArchiveBytes(archive, checksum);
  return archive;
}

async function bundleDocumentEngine() {
  const layout = packagePlatform();
  assertNativeBuildHost(layout);
  const runtimeSource = pythonRuntimes[layout.platform];
  const output = resolve(engineRoot, 'out', 'document-engine');
  // Stage inside generated output: all writes stay in the project workspace.
  mkdirSync(join(engineRoot, 'out'), { recursive: true });
  const staging = mkdtempSync(join(engineRoot, 'out', '.bundle-'));
  try {
    const archive = await archiveBytes(runtimeSource.url, runtimeSource.sha256, option('--runtime-archive'));
    const runtime = join(staging, 'python');
    if (layout.platform === 'win32') {
      const archivePath = join(staging, 'python.zip');
      writeFileSync(archivePath, archive);
      const buildPython = existsSync(python) ? python : 'python';
      execFileSync(buildPython, ['-m', 'zipfile', '-e', archivePath, runtime], { windowsHide: true });
      rmSync(archivePath);
      execFileSync(buildPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--only-binary=:all:',
        '--platform', 'win_amd64', '--python-version', '3.13', '--implementation', 'cp', '--abi', 'cp313',
        '--target', join(runtime, 'Lib', 'site-packages'), '-r', join(engineRoot, 'requirements.txt')],
        { stdio: 'inherit', windowsHide: true, timeout: 600_000 });
      writeFileSync(join(runtime, 'python313._pth'), 'python313.zip\n.\n../src\nLib/site-packages\nimport site\n');
    } else {
      const archivePath = join(staging, 'python.tar.gz');
      writeFileSync(archivePath, archive);
      execFileSync('tar', ['-xzf', archivePath, '-C', staging, '--no-same-owner'], { stdio: 'inherit', timeout: 120_000 });
      rmSync(archivePath);
      const noticesArchive = join(staging, 'runtime-full.tar.zst');
      writeFileSync(noticesArchive, await archiveBytes(runtimeSource.noticesUrl, runtimeSource.noticesSha256, option('--runtime-notices-archive')));
      const notices = join(runtime, 'runtime-notices');
      mkdirSync(notices);
      execFileSync('tar', ['--zstd', '-xf', noticesArchive, '-C', notices, '--strip-components=1', '--no-same-owner',
        'python/PYTHON.json', 'python/licenses'], { stdio: 'inherit', timeout: 120_000 });
      rmSync(noticesArchive);
      const executable = join(staging, layout.python);
      // Use this portable interpreter for its own compatible binary wheels.
      // This never installs into host Python and never copies a project venv.
      execFileSync(executable, ['-E', '-s', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--no-compile',
        '--only-binary=:all:', '--target', join(staging, layout.sitePackages), '-r', join(engineRoot, 'requirements.txt')],
        { cwd: staging, env: { ...process.env, PYTHONNOUSERSITE: '1' }, stdio: 'inherit', timeout: 600_000 });
    }
    cpSync(join(engineRoot, 'src'), join(staging, 'src'), { recursive: true,
      filter: (source) => !source.endsWith('__pycache__') && !source.endsWith('_test.py') && !source.endsWith('.pyc') });
    cpSync(join(engineRoot, 'requirements.txt'), join(staging, 'requirements.txt'));
    writeFileSync(join(staging, 'bundle-manifest.json'), JSON.stringify({ schema: 1, platform: layout.platform, arch: layout.arch,
      python: runtimeSource, requirementsSha256: createHash('sha256').update(readFileSync(join(staging, 'requirements.txt'))).digest('hex'),
    }, null, 2) + '\n');
    verifyBundle(staging);
    if (output !== resolve(root, 'packages/document-engine/out/document-engine')) throw new Error('Invalid bundle output path');
    rmSync(output, { recursive: true, force: true });
    copyBundle(staging, output);
    console.log('Document engine bundle ready: ' + output);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

if (args.includes('--help')) {
  console.log('Document engine: [--docling] | --bundle [--runtime-archive FILE] [--runtime-notices-archive FILE] | --verify-bundle DIR | --verify-package DIR [--skip-ui]\nNative Windows/Linux x64 only. Local archives must match the pinned upstream SHA256; no host-runtime fallback is permitted.');
} else if (args.includes('--bundle')) {
  await bundleDocumentEngine();
} else if (args.includes('--verify-package')) {
  const directory = option('--verify-package');
  if (!directory) throw new Error('Missing package directory');
  await verifyPackage(directory, { skipUi: args.includes('--skip-ui') });
} else if (args.includes('--verify-bundle')) {
  const bundle = option('--verify-bundle');
  if (!bundle) throw new Error('Missing bundle directory');
  verifyBundle(bundle);
} else {
  if (!existsSync(python)) {
    console.error('Missing venv. Run: npm run document-engine:setup');
    process.exit(1);
  }
  const requirements = args.includes('--docling') ? join(engineRoot, 'requirements-docling.txt') : join(engineRoot, 'requirements.txt');
  execFileSync(python, ['-m', 'pip', 'install', '-r', requirements], {
    stdio: 'inherit', cwd: root, env: { ...process.env, PYTHONUTF8: '1' },
  });
}

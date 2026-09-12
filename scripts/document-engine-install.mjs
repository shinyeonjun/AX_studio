import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..');
const engineRoot = join(root, 'packages', 'document-engine');
const venvDir = join(root, 'packages', 'document-engine', '.venv');
const python =
  process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python');

function verifyBundle(bundle) {
  const executable = join(bundle, 'python', 'python.exe');
  const scratch = mkdtempSync(join(tmpdir(), 'ax-document-smoke-'));
  // No PATH, Python environment, checkout cwd or installed packages at runtime.
  const options = { cwd: scratch, windowsHide: true, encoding: 'utf8', timeout: 60_000,
    env: { SystemRoot: process.env.SystemRoot, TEMP: scratch, TMP: scratch, PYTHONUTF8: '1' } };
  try {
    const pdf = join(scratch, 'sample.pdf');
    execFileSync(executable, ['-c',
      'import sys, cv2, pymupdf, pypdfium2; from reportlab.pdfgen import canvas; c=canvas.Canvas(sys.argv[1]); c.drawString(72,720,"AX packaged document smoke"); c.save()', pdf], options);
    const response = JSON.parse(execFileSync(executable, [join(bundle, 'src', 'worker.py')], {
      ...options, input: JSON.stringify({ id: 'package-smoke', command: 'ingest', params: {
        path: pdf, artifactRoot: join(scratch, 'artifacts'), options: { engine: 'basic' },
      } }),
    }));
    if (!response.ok || !JSON.stringify(response.data).includes('AX packaged document smoke')) {
      throw new Error('Packaged PDF ingestion failed: ' + JSON.stringify(response));
    }
    console.log('Packaged document engine: PDF creation, native imports and worker ingestion passed.');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

async function verifyPackage(directory) {
  const asar = await import('@electron/asar');
  const archive = join(directory, 'resources', 'app.asar');
  function verifyFiles(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const relative = join(prefix, name);
      if (entry.files) verifyFiles(entry, relative);
      else if (!entry.link && entry.integrity) {
        const hash = createHash('sha256').update(asar.extractFile(archive, relative)).digest('hex');
        if (hash !== entry.integrity.hash) throw new Error('Packaged file integrity mismatch: ' + relative);
      }
    }
  }
  verifyFiles(asar.getRawHeader(archive).header);
  verifyBundle(join(directory, 'resources', 'document-engine'));
  const { _electron } = await import('@playwright/test');
  const scratch = mkdtempSync(join(tmpdir(), 'ax-package-ui-'));
  let app;
  try {
    const env = { ...process.env, AX_DATA_ROOT: join(scratch, 'data'), AX_E2E: '1', AX_E2E_FAKE_AGENT: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    delete env.AX_E2E_DOCUMENT_ENGINE;
    app = await _electron.launch({ executablePath: join(directory, 'AX Studio.exe'),
      args: ['--user-data-dir=' + join(scratch, 'profile')], cwd: scratch, env, timeout: 60_000 });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '새 대화', exact: true }).waitFor({ timeout: 30_000 });
    if (!await app.evaluate(({ app }) => app.isPackaged)) throw new Error('Expected packaged application');
    console.log('Packaged app: archive integrity and isolated startup passed.');
  } finally {
    if (app) await app.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function bundleWindows() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Document engine packaging currently requires Windows x64.');
  }
  // Official embeddable runtime, checksum from python.org/downloads/release/python-31315/.
  const version = '3.13.15';
  const checksum = 'd1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf';
  const output = resolve(engineRoot, 'out', 'document-engine');
  const staging = mkdtempSync(join(tmpdir(), 'ax-document-bundle-'));
  const buildPython = existsSync(python) ? python : 'python';
  try {
    const response = await fetch('https://www.python.org/ftp/python/' + version + '/python-' + version + '-embed-amd64.zip',
      { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error('Python download failed: HTTP ' + response.status);
    const archive = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(archive).digest('hex') !== checksum) throw new Error('Python archive checksum mismatch');
    const archivePath = join(staging, 'python.zip');
    writeFileSync(archivePath, archive);
    const runtime = join(staging, 'python');
    execFileSync(buildPython, ['-m', 'zipfile', '-e', archivePath, runtime], { windowsHide: true });
    rmSync(archivePath);
    execFileSync(buildPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:',
      '--platform', 'win_amd64', '--python-version', '3.13', '--implementation', 'cp', '--abi', 'cp313',
      '--target', join(runtime, 'Lib', 'site-packages'), '-r', join(engineRoot, 'requirements.txt')],
      { stdio: 'inherit', windowsHide: true, timeout: 600_000 });
    writeFileSync(join(runtime, 'python313._pth'), 'python313.zip\n.\n../src\nLib/site-packages\nimport site\n');
    cpSync(join(engineRoot, 'src'), join(staging, 'src'), { recursive: true,
      filter: (source) => !source.endsWith('__pycache__') && !source.endsWith('_test.py') && !source.endsWith('.pyc') });
    cpSync(join(engineRoot, 'requirements.txt'), join(staging, 'requirements.txt'));
    verifyBundle(staging);
    // Fixed generated-output path only; never delete a caller-provided location.
    if (output !== resolve(root, 'packages/document-engine/out/document-engine')) throw new Error('Invalid bundle path');
    rmSync(output, { recursive: true, force: true });
    mkdirSync(resolve(output, '..'), { recursive: true });
    cpSync(staging, output, { recursive: true });
    console.log('Document engine bundle ready: ' + output);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

if (process.argv.includes('--bundle')) {
  await bundleWindows();
} else if (process.argv.includes('--verify-package')) {
  const directory = process.argv[process.argv.indexOf('--verify-package') + 1];
  if (!directory) throw new Error('Missing package directory');
  await verifyPackage(resolve(directory));
} else if (process.argv.includes('--verify-bundle')) {
  const bundle = process.argv[process.argv.indexOf('--verify-bundle') + 1];
  if (!bundle) throw new Error('Missing bundle directory');
  verifyBundle(resolve(bundle));
} else {
  if (!existsSync(python)) {
    console.error('Missing venv. Run: npm run document-engine:setup');
    process.exit(1);
  }
  const requirements = process.argv.includes('--docling')
    ? join(engineRoot, 'requirements-docling.txt')
    : join(engineRoot, 'requirements.txt');
  execFileSync(python, ['-m', 'pip', 'install', '-r', requirements], {
    stdio: 'inherit', cwd: root, env: { ...process.env, PYTHONUTF8: '1' },
  });
}

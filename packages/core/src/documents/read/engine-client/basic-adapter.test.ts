import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StdioDocumentEngineClient } from '../engine-client.js';
import { defaultPythonPath, defaultWorkerScript, setDocumentEngineEnvOverridesAllowed } from './paths.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('resolves the installed worker and Python without relying on the checkout', () => {
  const resources = mkdtempSync(join(tmpdir(), 'ax-installed-'));
  const worker = join(resources, 'document-engine', 'src', 'worker.py');
  const python = join(resources, 'document-engine', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
  try {
    mkdirSync(join(resources, 'document-engine', 'src'), { recursive: true });
    mkdirSync(join(resources, 'document-engine', 'python', 'bin'), { recursive: true });
    writeFileSync(worker, '');
    writeFileSync(python, '');
    vi.stubEnv('AX_DOCUMENT_ENGINE_WORKER', undefined);
    vi.stubEnv('AX_DOCUMENT_ENGINE_PYTHON', undefined);
    vi.stubGlobal('process', { ...process, resourcesPath: resources });
    expect(defaultWorkerScript()).toBe(worker);
    expect(defaultPythonPath()).toBe(python);
  } finally { rmSync(resources, { recursive: true, force: true }); }
});

it('fails closed when the installed Python is missing instead of using a venv or host Python', () => {
  const resources = mkdtempSync(join(tmpdir(), 'ax-installed-missing-python-'));
  const engine = join(resources, 'document-engine');
  const worker = join(engine, 'src', 'worker.py');
  const venvPython = join(engine, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  try {
    mkdirSync(join(engine, 'src'), { recursive: true });
    mkdirSync(join(engine, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin'), { recursive: true });
    writeFileSync(worker, '');
    writeFileSync(venvPython, '');
    vi.stubEnv('AX_DOCUMENT_ENGINE_WORKER', undefined);
    vi.stubEnv('AX_DOCUMENT_ENGINE_PYTHON', undefined);
    vi.stubGlobal('process', { ...process, resourcesPath: resources });
    expect(() => defaultPythonPath()).toThrow('Packaged document-engine Python is missing');
  } finally { rmSync(resources, { recursive: true, force: true }); }
});

it('fails closed for a missing packaged worker even when the checkout is available', () => {
  const resources = mkdtempSync(join(tmpdir(), 'ax-installed-missing-worker-'));
  try {
    writeFileSync(join(resources, 'app.asar'), 'package marker');
    vi.stubEnv('AX_DOCUMENT_ENGINE_WORKER', undefined);
    vi.stubGlobal('process', { ...process, resourcesPath: resources });
    expect(() => defaultWorkerScript()).toThrow('Packaged document-engine worker is missing');
  } finally { rmSync(resources, { recursive: true, force: true }); }
});

it('preserves explicit developer Python overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ax-python-override-'));
  const python = join(dir, process.platform === 'win32' ? 'python.exe' : 'python3');
  try {
    writeFileSync(python, '');
    vi.stubEnv('AX_DOCUMENT_ENGINE_PYTHON', python);
    expect(defaultPythonPath(join(dir, 'src/worker.py'))).toBe(python);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

describe('StdioDocumentEngineClient integration', () => {
  it('ingests a text file via basic adapter when python is available', async (context) => {
    if (spawnSync(defaultPythonPath(), ['-c', 'import pypdf'], { windowsHide: true }).status !== 0) {
      context.skip();
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'ax-doc-'));
    const filePath = join(dir, 'sample.txt');
    writeFileSync(filePath, 'hello document engine', 'utf8');
    const artifactRoot = join(dir, 'artifacts');

    const client = new StdioDocumentEngineClient({
      artifactRoot,
      timeoutMs: 30_000,
    });

    try {
      const result = await client.ingest(filePath, { engine: 'basic' });
      expect(result.summary.chunkCount).toBeGreaterThan(0);
      expect(result.summary.engine).toBe('basic');
      expect(result.text).toContain('hello document engine');

      const page = await client.getPage(result.documentId, 0);
      expect(page.text).toContain('hello document engine');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('packaged environment overrides', () => {
  afterEach(() => setDocumentEngineEnvOverridesAllowed(undefined));

  function withPackagedResources(run: (paths: { worker: string; python: string; hostPython: string }) => void) {
    const resources = mkdtempSync(join(tmpdir(), 'ax-packaged-env-'));
    const worker = join(resources, 'document-engine', 'src', 'worker.py');
    const python = join(resources, 'document-engine', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
    const hostPython = join(resources, 'host-python');
    try {
      mkdirSync(join(resources, 'document-engine', 'src'), { recursive: true });
      mkdirSync(join(resources, 'document-engine', 'python', 'bin'), { recursive: true });
      writeFileSync(join(resources, 'app.asar'), 'package marker');
      writeFileSync(worker, '');
      writeFileSync(python, '');
      writeFileSync(hostPython, '');
      vi.stubEnv('AX_DOCUMENT_ENGINE_WORKER', hostPython);
      vi.stubEnv('AX_DOCUMENT_ENGINE_PYTHON', hostPython);
      vi.stubGlobal('process', { ...process, resourcesPath: resources });
      run({ worker, python, hostPython });
    } finally { rmSync(resources, { recursive: true, force: true }); }
  }

  it('ignores AX_DOCUMENT_ENGINE_* in a packaged app', () => {
    withPackagedResources(({ worker, python }) => {
      expect(defaultWorkerScript()).toBe(worker);
      expect(defaultPythonPath()).toBe(python);
    });
  });

  it('follows the host policy and an explicit option', () => {
    withPackagedResources(({ worker, python, hostPython }) => {
      setDocumentEngineEnvOverridesAllowed(true);
      expect(defaultPythonPath(worker)).toBe(hostPython);
      setDocumentEngineEnvOverridesAllowed(false);
      expect(defaultPythonPath(worker)).toBe(python);
      expect(defaultPythonPath(worker, { allowEnvOverrides: true })).toBe(hostPython);
    });
  });
});

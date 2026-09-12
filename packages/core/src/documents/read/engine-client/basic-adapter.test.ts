import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StdioDocumentEngineClient } from '../engine-client.js';
import { defaultPythonPath, defaultWorkerScript } from './paths.js';

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

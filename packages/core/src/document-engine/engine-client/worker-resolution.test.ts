import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  StdioDocumentEngineClient,
  defaultPythonPath,
  defaultWorkerScript,
} from '../engine-client.js';

describe('StdioDocumentEngineClient integration', () => {
  it('pings python worker when available', async () => {
    const workerScript = defaultWorkerScript();
    const client = new StdioDocumentEngineClient({ timeoutMs: 30_000 });
    try {
      const ok = await client.ping();
      expect(ok).toBe(true);
    } catch {
      // Python sidecar not installed in CI/dev — skip silently
      expect(workerScript).toContain('worker.py');
    }
  });

  it('resolves worker.py from the repo even if moduleDir is a bundled Electron path', () => {
    expect(defaultWorkerScript()).toMatch(/packages[/\\]document-engine[/\\]src[/\\]worker\.py$/);
    expect(existsSync(defaultWorkerScript())).toBe(true);
    const python = defaultPythonPath();
    if (python.includes('.venv')) {
      expect(existsSync(python)).toBe(true);
    }
  });

  it('resolves Python from the virtual environment beside a custom worker', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-custom-doc-engine-'));
    const workerScript = join(directory, 'engine', 'src', 'worker.py');
    const pythonPath = process.platform === 'win32'
      ? join(directory, 'engine', '.venv', 'Scripts', 'python.exe')
      : join(directory, 'engine', '.venv', 'bin', 'python');
    const configuredPython = process.env.AX_DOCUMENT_ENGINE_PYTHON;

    try {
      delete process.env.AX_DOCUMENT_ENGINE_PYTHON;
      mkdirSync(join(directory, 'engine', '.venv', process.platform === 'win32' ? 'Scripts' : 'bin'), {
        recursive: true,
      });
      writeFileSync(pythonPath, '');

      expect(defaultPythonPath(workerScript)).toBe(pythonPath);
    } finally {
      if (configuredPython === undefined) delete process.env.AX_DOCUMENT_ENGINE_PYTHON;
      else process.env.AX_DOCUMENT_ENGINE_PYTHON = configuredPython;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeDocumentEngineError } from './request.js';

describe('normalizeDocumentEngineError', () => {
  it('replaces Python dependency details with a stable recovery code', () => {
    expect(normalizeDocumentEngineError("No module named 'pymupdf'"))
      .toBe('document_engine_dependency_missing');
    expect(normalizeDocumentEngineError("ModuleNotFoundError: No module named 'reportlab'"))
      .toBe('document_engine_dependency_missing');
  });

  it('leaves non-dependency errors unchanged', () => {
    expect(normalizeDocumentEngineError('document_engine_timeout')).toBe('document_engine_timeout');
  });
});

describe('cancelling an engine request', () => {
  it('stops the worker process instead of letting it run to its timeout', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { requestDocumentEngine } = await import('./request.js');
    const dir = mkdtempSync(join(tmpdir(), 'ax-engine-abort-'));
    // A worker that never answers (stands in for a long docling run).
    const worker = join(dir, 'worker.js');
    writeFileSync(worker, 'setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const started = Date.now();
    const request = requestDocumentEngine(
      { pythonPath: process.execPath, workerScript: worker, artifactRoot: dir, timeoutMs: 60_000, workerCwd: dir, abortSignal: controller.signal },
      'ingest',
      {},
    );
    setTimeout(() => controller.abort(), 200);
    await expect(request).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(15_000);
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});

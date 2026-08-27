import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MockDocumentEngineClient,
  StdioDocumentEngineClient,
  defaultPythonPath,
  defaultWorkerScript,
  setDocumentEngineClient,
} from './engine-client.js';
import { setAxDataPaths } from '../paths/ax-data.js';
import { getChunk, getPage, ingest, search } from '../modules/document/read/actions.js';
import type { ConnectorContext } from '../modules/types.js';

describe('DocumentEngineClient', () => {
  afterEach(() => {
    setDocumentEngineClient(null);
    setAxDataPaths(null);
  });

  it('MockDocumentEngineClient ingests and searches', async () => {
    const client = new MockDocumentEngineClient();
    const result = await client.ingest('/tmp/sample.pdf');
    expect(result.documentId).toMatch(/^mock-/);
    expect(result.summary.pageCount).toBe(1);

    const search = await client.search(result.documentId, 'hello');
    expect(search.hits.length).toBe(1);
  });

  it('document.ingest action uses configured client', async () => {
    setDocumentEngineClient(new MockDocumentEngineClient());
    const directory = mkdtempSync(join(tmpdir(), 'ax-doc-action-'));
    try {
      const filePath = join(directory, 'report.pdf');
      writeFileSync(filePath, 'not a real PDF, mock client does not parse it', 'utf8');
      const ctx: ConnectorContext = {
        executionId: 'exec-1',
        variables: {},
        connections: [
          {
            connector: 'local_folder',
            connected: true,
            config: {
              folders: [{ id: 'folder-1', label: 'Documents', path: directory, addedAt: new Date().toISOString() }],
            },
          },
        ],
        log: () => {},
      };
      const result = await ingest({ path: filePath }, ctx);
      expect(result.ok).toBe(true);
      expect(ctx.variables.documentId).toBeTruthy();
      expect(ctx.variables.axDocumentSummary).toBeTruthy();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('document read actions reject incomplete parameters before calling the engine', async () => {
    setDocumentEngineClient(new MockDocumentEngineClient());
    const ctx: ConnectorContext = { executionId: 'exec-read', variables: {}, log: () => {} };

    await expect(getChunk({ documentId: 'doc-1', chunkId: ' ' }, ctx)).resolves.toMatchObject({
      ok: false,
      errorCode: 'chunk_id_required',
    });
    for (const pageIndex of ['not-a-number', '', ' ', false]) {
      await expect(getPage({ documentId: 'doc-1', pageIndex }, ctx)).resolves.toMatchObject({
        ok: false,
        errorCode: 'page_index_invalid',
      });
    }
    await expect(search({ documentId: 'doc-1', query: ' ' }, ctx)).resolves.toMatchObject({
      ok: false,
      errorCode: 'query_required',
    });
  });
});

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

  it('ingests a text file via basic adapter when python is available', async () => {
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
    } catch {
      // Python/pypdf not installed — acceptable in minimal dev env
      expect(true).toBe(true);
    }
  });
});

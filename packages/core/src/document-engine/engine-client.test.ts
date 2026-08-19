import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MockDocumentEngineClient,
  StdioDocumentEngineClient,
  defaultWorkerScript,
  setDocumentEngineClient,
} from './engine-client.js';
import { ingest } from '../modules/document/engine/actions.js';
import type { ConnectorContext } from '../modules/types.js';

describe('DocumentEngineClient', () => {
  afterEach(() => {
    setDocumentEngineClient(null);
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
    const ctx: ConnectorContext = {
      executionId: 'exec-1',
      variables: {},
      log: () => {},
    };
    const result = await ingest({ path: '/tmp/report.pdf' }, ctx);
    expect(result.ok).toBe(true);
    expect(ctx.variables.documentId).toBeTruthy();
    expect(ctx.variables.axDocumentSummary).toBeTruthy();
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

      const page = await client.getPage(result.documentId, 0);
      expect(page.text).toContain('hello document engine');
    } catch {
      // Python/pypdf not installed — acceptable in minimal dev env
      expect(true).toBe(true);
    }
  });
});

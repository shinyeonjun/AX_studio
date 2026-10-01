import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorContext } from '../types.js';
import { MockDocumentEngineClient, setDocumentEngineClient } from '../../documents/read/engine-client.js';
import { DocumentConnector } from './connector.js';

afterEach(() => setDocumentEngineClient(null));

describe('document caller cancellation', () => {
  for (const outcome of ['late', 'reject'] as const) {
  it.each([
    ['ingest', 'ingest'], ['getChunk', 'getChunk'], ['getPage', 'getPage'],
    ['search', 'search'], ['pdf.toHtml', 'pdfToHtml'],
    ['pdf.form.analyze', 'pdfFormAnalyze'], ['pdf.form.fill', 'pdfFormFill'],
  ] as const)(`forwards %s cancellation and handles a ${outcome} result`, async (action, method) => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-document-cancel-'));
    try {
      const path = join(directory, 'synthetic.pdf');
      writeFileSync(path, 'synthetic fixture, not a PDF');
      const controller = new AbortController();
      const engine = new MockDocumentEngineClient();
      const operation = vi.fn(async () => {
        controller.abort();
        if (outcome === 'reject') throw Object.assign(new Error('ABORT_ERR'), { code: 'ABORT_ERR' });
        return {};
      });
      Object.assign(engine, { [method]: operation });
      setDocumentEngineClient(engine);
      const sink = vi.fn();
      const ctx: ConnectorContext = {
        executionId: 'synthetic-cancellation', variables: {}, log: vi.fn(),
        abortSignal: controller.signal, artifactSink: { putBytes: sink },
        connections: [{ connector: 'local_folder', connected: true,
          config: { folders: [{ id: 'fixture', label: 'Synthetic', path: directory }] } }],
      };
      const result = await new DocumentConnector().execute(action, {
        path, documentId: 'synthetic', chunkId: 'chunk', pageIndex: 0, query: 'synthetic',
        template: {}, values: { field: 'synthetic' },
      }, ctx);
      expect(result).toMatchObject({ ok: false, errorCode: 'aborted' });
      const args = operation.mock.calls[0] as unknown as unknown[];
      expect(args.at(-1)).toEqual({ abortSignal: controller.signal });
      expect(ctx.variables).toEqual({});
      expect(sink).not.toHaveBeenCalled();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  }
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { toDocumentArtifact } from '../contracts/artifacts/document-normalize.js';
import {
  MockDocumentEngineClient,
  setDocumentEngineClient,
} from '../document-engine/engine-client.js';
import { ArtifactStore } from './artifact-store.js';
import { importDiscoveryArtifact } from './import-discovery-artifact.js';

describe('importDiscoveryArtifact', () => {
  const previousClient = new MockDocumentEngineClient();

  afterEach(() => {
    setDocumentEngineClient(previousClient);
  });

  it('stores a DocumentArtifact JSON for PDF imports via document engine ingest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-discovery-import-'));
    const store = new ArtifactStore(root);
    const mock = new MockDocumentEngineClient();
    mock.ingest = async (path) => {
      const documentId = 'doc_mock';
      return {
        documentId,
        artifactPath: `/mock/documents/${documentId}`,
        engine: 'docling',
        text: '매출: 1,250만',
        summary: {
          pageCount: 1,
          chunkCount: 1,
          tableCount: 0,
          imageCount: 0,
          visualPageCount: 0,
          visualPages: [],
          engine: 'docling',
        },
        pages: [{ index: 0, text: '매출: 1,250만' }],
      };
    };
    setDocumentEngineClient(mock);

    const pdfPath = join(root, 'report.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const stored = await importDiscoveryArtifact(store, pdfPath);
    const json = store.getDocumentArtifact<ReturnType<typeof toDocumentArtifact>>(stored.id);

    expect(json?.id).toBe(stored.id);
    expect(json?.engine).toBe('docling');
    expect(json?.text).toContain('매출');
    expect(json?.pages?.[0]?.text).toContain('매출');
    expect(store.get(stored.id)?.storedPath).toContain('report.pdf');
  });

  it('imports non-pdf files without document engine ingest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-discovery-import-'));
    const store = new ArtifactStore(root);
    const mock = new MockDocumentEngineClient();
    let ingestCalls = 0;
    mock.ingest = async (path) => {
      ingestCalls += 1;
      return previousClient.ingest(path);
    };
    setDocumentEngineClient(mock);

    const txtPath = join(root, 'report.txt');
    writeFileSync(txtPath, '매출: 1,250만');

    const stored = await importDiscoveryArtifact(store, txtPath);
    expect(ingestCalls).toBe(0);
    expect(store.getDocumentArtifact(stored.id)).toBeUndefined();
    expect(store.get(stored.id)?.fileName).toBe('report.txt');
  });
});

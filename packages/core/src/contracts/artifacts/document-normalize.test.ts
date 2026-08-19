import { describe, expect, it } from 'vitest';
import { toDocumentArtifact } from './document-normalize.js';

describe('toDocumentArtifact', () => {
  it('maps ingest result into DocumentArtifact contract', () => {
    const artifact = toDocumentArtifact(
      {
        documentId: 'doc-1',
        artifactPath: '/tmp/doc.json',
        engine: 'basic',
        summary: {
          pageCount: 2,
          chunkCount: 3,
          tableCount: 1,
          imageCount: 0,
          visualPageCount: 1,
          visualPages: [1],
          engine: 'basic',
        },
        text: 'hello world',
      },
      {
        path: 'C:\\docs\\sample.pdf',
        name: 'sample.pdf',
        folderId: 'folder-1',
      },
    );

    expect(artifact).toEqual({
      id: 'doc-1',
      source: {
        path: 'C:\\docs\\sample.pdf',
        name: 'sample.pdf',
        folderId: 'folder-1',
      },
      artifactPath: '/tmp/doc.json',
      engine: 'basic',
      pageCount: 2,
      chunkCount: 3,
      tableCount: 1,
      imageCount: 0,
      text: 'hello world',
      pages: [{ index: 1, hasVisual: true }],
    });
  });
});

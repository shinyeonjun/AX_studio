import { describe, expect, it } from 'vitest';
import { toDocumentArtifact } from './document-normalize.js';

describe('toDocumentArtifact', () => {
  it('maps ingest result into DocumentArtifact contract', () => {
    const artifact = toDocumentArtifact(
      {
        documentId: 'doc-1',
        artifactPath: '/tmp/doc.json',
        engine: 'docling',
        summary: {
          pageCount: 2,
          chunkCount: 3,
          tableCount: 1,
          imageCount: 1,
          visualPageCount: 1,
          visualPages: [1],
          ocrPageCount: 1,
          ocrPages: [1],
          engine: 'docling',
        },
        text: 'hello world',
        pages: [
          {
            index: 0,
            sourceType: 'native',
            hasVisual: false,
            ocrApplied: false,
          },
          {
            index: 1,
            sourceType: 'scan',
            hasVisual: true,
            ocrApplied: true,
            imagePath: '/tmp/page1.png',
            ocrConfidence: 0.91,
          },
        ],
        images: [{ id: 'img0', pageIndex: 1, path: '/tmp/img0.png', ocrText: 'scan text' }],
        tables: [{ id: 'tbl0', pageIndex: 0, text: '| a | b |' }],
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
      engine: 'docling',
      pageCount: 2,
      chunkCount: 3,
      tableCount: 1,
      imageCount: 1,
      text: 'hello world',
      pages: [
        { index: 0, hasVisual: false, sourceType: 'native', ocrApplied: false },
        {
          index: 1,
          hasVisual: true,
          sourceType: 'scan',
          ocrApplied: true,
          imagePath: '/tmp/page1.png',
          ocrConfidence: 0.91,
        },
      ],
      images: [{ id: 'img0', pageIndex: 1, path: '/tmp/img0.png', ocrText: 'scan text' }],
      tables: [{ id: 'tbl0', pageIndex: 0, text: '| a | b |' }],
    });
  });
});

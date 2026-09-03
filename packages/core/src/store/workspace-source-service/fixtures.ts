import { MockDocumentEngineClient } from '../../document-engine/engine-client.js';

export function mockEngine(text = '운영 서버 이전 일정이 확정되었습니다.') {
  const client = new MockDocumentEngineClient();
  client.ingest = async () => ({
    documentId: 'doc_session_fixture',
    artifactPath: '/private/engine-output/doc_session_fixture',
    engine: 'docling',
    text,
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
    pages: [
      { index: 0, text },
      { index: 1, text: '근거 페이지', hasVisual: true, ocrApplied: true },
    ],
    images: [{ id: 'img_1', pageIndex: 1, path: '/private/image.png', ocrText: '차트' }],
    tables: [{ id: 'table_1', pageIndex: 0, text: '항목 | 값' }],
  });
  return client;
}

import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const DOCUMENT_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'document.ingest',
    connector: 'document',
    kind: 'read',
    label: '문서 읽기',
    description: 'Document Engine으로 문서 파싱',
    sideEffect: 'NONE',
    params: [{ name: 'path', label: '문서 경로', question: '어떤 문서를 읽을까요?', required: true }],
    io: { inputs: { source: 'DocumentIngestInput' }, outputs: { document: 'DocumentArtifact' } },
  },
  {
    id: 'document.getChunk',
    connector: 'document',
    kind: 'read',
    label: '문서 청크',
    description: '저장된 문서 청크 불러오기',
    sideEffect: 'NONE',
    params: [
      { name: 'documentId', label: '문서 ID', question: '어떤 문서인가요?', required: false },
      { name: 'chunkId', label: '청크 ID', question: '어떤 청크를 가져올까요?', required: true },
    ],
  },
  {
    id: 'document.getPage',
    connector: 'document',
    kind: 'read',
    label: '문서 페이지',
    description: '저장된 문서 페이지 불러오기',
    sideEffect: 'NONE',
    params: [
      { name: 'documentId', label: '문서 ID', question: '어떤 문서인가요?', required: false },
      { name: 'pageIndex', label: '페이지', question: '몇 페이지를 읽을까요?', required: true },
    ],
  },
  {
    id: 'document.search',
    connector: 'document',
    kind: 'read',
    label: '문서 검색',
    description: '문서 청크 검색',
    sideEffect: 'NONE',
    params: [
      { name: 'documentId', label: '문서 ID', question: '어떤 문서에서 찾을까요?', required: false },
      { name: 'query', label: '검색어', question: '무엇을 찾을까요?', required: true },
    ],
  },
  {
    id: 'document.html.render',
    connector: 'document',
    kind: 'write',
    label: 'HTML 생성',
    description: 'HTML 문서 렌더',
    sideEffect: 'REVERSIBLE',
    params: [
      { name: 'template', label: 'Handlebars 템플릿', question: '문서 HTML 템플릿을 입력하세요.', required: false },
      { name: 'title', label: '제목', question: '문서 제목', required: false },
      { name: 'data', label: '데이터', question: '템플릿에 넣을 데이터', required: false },
    ],
  },
  {
    id: 'document.docx.fill',
    connector: 'document',
    kind: 'write',
    label: 'DOCX 작성',
    description: 'DOCX 양식 채우기',
    sideEffect: 'REVERSIBLE',
    params: [{ name: 'template', label: '문서 양식', question: '어떤 문서 양식을 사용할까요?', required: true }],
  },
  {
    id: 'document.pdf.toHtml',
    connector: 'document',
    kind: 'write',
    label: 'PDF → HTML 양식',
    description: 'PDF를 HTML 템플릿으로 변환 (Docling export_to_html)',
    sideEffect: 'REVERSIBLE',
    params: [
      { name: 'path', label: 'PDF 경로', question: '어떤 PDF를 양식으로 등록할까요?', required: true },
    ],
  },
  {
    id: 'document.pdf.generate',
    connector: 'document',
    kind: 'write',
    label: 'PDF 생성',
    description: 'HTML을 PDF로 변환 (desktop printToPDF)',
    sideEffect: 'REVERSIBLE',
    params: [
      { name: 'html', label: 'HTML', question: 'PDF로 변환할 HTML', required: false },
      { name: 'title', label: '제목', question: 'PDF 제목', required: false },
    ],
  },
];

export const DOCUMENT_CATALOG: ConnectorCatalogEntry = {
  id: 'document',
  label: 'Document',
  description: 'HTML/DOCX/PDF 등 문서 읽기·생성',
  connectable: false,
  alwaysReal: true,
  runtimeAvailable: true,
  connectionKind: 'builtin',
  emoji: '📄',
};

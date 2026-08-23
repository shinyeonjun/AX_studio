import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const HTTP_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'http.request',
    connector: 'http',
    kind: 'read',
    label: 'HTTP 요청',
    description: '연결된 base URL로 REST 요청 (GET은 조회, 그 외는 쓰기)',
    params: [
      { name: 'method', label: 'HTTP 메서드', question: '어떤 HTTP 메서드를 사용할까요?', required: false },
      { name: 'path', label: '경로', question: 'base URL 기준 경로는 무엇인가요?', required: true },
      { name: 'headers', label: '헤더', question: '추가 헤더가 있나요?', required: false },
      { name: 'body', label: '본문', question: '요청 본문이 있나요?', required: false },
    ],
    io: { inputs: {}, outputs: { response: 'TextArtifact' } },
  },
];

export const HTTP_CATALOG: ConnectorCatalogEntry = {
  id: 'http',
  label: 'HTTP',
  description: 'REST API 아웃바운드 요청',
  connectable: true,
  alwaysReal: false,
  runtimeAvailable: true,
  connectionKind: 'config',
  emoji: '🌐',
};

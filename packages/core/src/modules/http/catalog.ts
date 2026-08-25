import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const HTTP_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'http.request',
    connector: 'http',
    kind: 'read',
    label: 'HTTP 요청',
    description: '선택한 HTTP 연결(connectionId, 생략 시 기본 연결)의 base URL로 GET/HEAD REST 조회 (외부 변경은 http.post 사용)',
    readMethods: ['GET', 'HEAD'],
    params: [
      { name: 'method', label: 'HTTP 메서드', question: '어떤 HTTP 메서드를 사용할까요?', required: false },
      { name: 'connectionId', label: 'HTTP 연결', question: '이 요청에 사용할 HTTP 연결은 무엇인가요?', required: false },
      { name: 'path', label: '경로', question: 'base URL 기준 경로는 무엇인가요?', required: true },
      { name: 'headers', label: '헤더', question: '추가 헤더가 있나요?', required: false },
    ],
    io: { inputs: {}, outputs: { response: 'TextArtifact' } },
  },
  {
    id: 'http.post',
    connector: 'http',
    kind: 'write',
    label: 'HTTP POST',
    description: '선택한 HTTP 연결(connectionId, 생략 시 기본 연결)의 base URL로 JSON 또는 문자열 POST 요청을 보냅니다.',
    sideEffect: 'EXTERNAL',
    params: [
      { name: 'connectionId', label: 'HTTP 연결', question: '이 요청에 사용할 HTTP 연결은 무엇인가요?', required: false },
      { name: 'path', label: '경로', question: 'base URL 기준 POST 경로는 무엇인가요?', required: true },
      { name: 'body', label: '본문', question: 'POST로 보낼 JSON 또는 문자열 본문은 무엇인가요?', required: true },
      { name: 'headers', label: '헤더', question: '추가 헤더가 있나요?', required: false },
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

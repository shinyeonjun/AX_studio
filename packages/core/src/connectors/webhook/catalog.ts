import type { ConnectorCapability } from '../../catalog/capability-types.js';
import type { ConnectorCatalogEntry } from '../../catalog/connector-types.js';

export const WEBHOOK_CAPABILITIES: ConnectorCapability[] = [
  {
    id: 'webhook.inbound',
    connector: 'webhook',
    kind: 'trigger',
    label: 'Webhook 수신',
    description: '로컬 HTTP POST로 업무를 시작합니다',
    params: [
      {
        name: 'path',
        label: 'Webhook 경로',
        question: 'Webhook 경로는 무엇인가요? (예: invoice-paid)',
        required: true,
      },
    ],
    io: { inputs: {}, outputs: { body: 'TextArtifact', path: 'TextArtifact' } },
  },
];

export const WEBHOOK_CATALOG: ConnectorCatalogEntry = {
  id: 'webhook',
  label: 'Webhook',
  description: '로컬 HTTP 수신 트리거',
  connectable: true,
  alwaysReal: false,
  runtimeAvailable: true,
  connectionKind: 'config',
  emoji: '🔔',
};

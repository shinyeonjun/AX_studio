import type { ModulePackage } from '../module-package.js';
import {
  mergeWebhookSecret,
  parseWebhookConnectionConfig,
} from '../webhook/index.js';
import { webhookInboundHandler, webhookPathsMatch } from '../../triggers/webhook/index.js';
import { WebhookInboundListener } from '../../triggers/webhook/listener.js';
import { resolveWebhookAuthSecret } from '../../triggers/webhook/secret-provider.js';
import { WEBHOOK_CAPABILITIES, WEBHOOK_CATALOG } from './catalog-data.js';

export const webhookModulePackage: ModulePackage = {
  id: 'webhook',
  catalog: WEBHOOK_CATALOG,
  capabilities: WEBHOOK_CAPABILITIES,
  registration: {
    instantiate: () => null,
  },
  triggerHandlers: [webhookInboundHandler],
  pushTriggerDriver: {
    triggerType: 'webhook.inbound',
    async refresh(store, emit) {
      const connection = store.getConnections().find((entry) => entry.connector === 'webhook');
      const parsed = parseWebhookConnectionConfig(connection?.config);
      if (!connection?.connected || !parsed) return undefined;

      const secret = await resolveWebhookAuthSecret(connection.config);
      const merged = mergeWebhookSecret(parsed, secret);
      if (!merged) return undefined;

      const listener = new WebhookInboundListener();
      await listener.start({ port: merged.port, secret: merged.secret }, emit);
      return listener;
    },
    matchesTrigger(trigger, event) {
      if (event.type !== 'webhook.inbound') return false;
      return webhookPathsMatch(String(trigger.path ?? ''), String(event.payload.path ?? ''));
    },
    dedupeKey(workflowId, event) {
      return `${workflowId}:webhook:${String(event.payload.requestId ?? event.payload.receivedAt ?? '')}`;
    },
  },
};

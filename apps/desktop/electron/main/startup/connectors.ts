import type { createAxStudioCore } from '@ax-studio/core';
import { hydrateGmailConnector } from '../gmail/connection.js';
import { hydrateSlackConnector, type SlackSecret } from '../slack/connection.js';
import { hydrateHttpConnector } from '../http/connection.js';
import { hydrateWebhookConnection } from '../webhook/connection.js';
import { hydrateRdbConnector } from '../rdb/connection.js';
import { hydrateOpenApiConnector } from '../openapi/connection.js';
import { hydrateMcpConnector } from '../mcp/connection.js';
import { loadGoogleDesktopClient } from '../gmail/oauth-client.js';

type DesktopCore = Awaited<ReturnType<typeof createAxStudioCore>>;

export async function hydrateConnectorsForStartup(
  core: DesktopCore,
): Promise<SlackSecret | null> {
  const errors: Record<string, string> = {};
  core.store.setSetting('startup.connectorErrors', errors);

  async function runStep<T>(label: string, step: () => Promise<T>, fallback: T): Promise<T> {
    const saved = core.store.getConnections().find(entry => entry.connector === label);
    try {
      return await step();
    } catch {
      // Preserve credentials/config for explicit repair; never continue with a partially hydrated connector.
      core.runtime.setConnector(label, null);
      if (saved) core.store.setConnection(label, false, saved.config);
      errors[label] = '저장된 연결을 복원하지 못했습니다. 설정에서 연결을 다시 확인해 주세요.';
      core.store.setSetting('startup.connectorErrors', { ...errors });
      console.warn(`[AX Studio] ${label} connection requires reconfiguration.`);
      return fallback;
    }
  }

  await runStep('gmail', async () => {
    await loadGoogleDesktopClient();
    await hydrateGmailConnector(core.store, core.runtime);
  }, undefined);
  const slackSecret = await runStep(
    'slack',
    () => hydrateSlackConnector(core.store, core.runtime),
    null,
  );
  await runStep('http', () => hydrateHttpConnector(core.store, core.runtime), undefined);
  await runStep('webhook', () => hydrateWebhookConnection(core.store), undefined);
  await runStep('rdb', () => hydrateRdbConnector(core.store, core.runtime), undefined);
  await runStep('openapi', () => hydrateOpenApiConnector(core.store, core.runtime), undefined);
  await runStep('mcp', () => hydrateMcpConnector(core.store, core.runtime), undefined);
  return slackSecret;
}

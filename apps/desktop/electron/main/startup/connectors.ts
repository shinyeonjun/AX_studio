import type { createAxStudioCore } from '@ax-studio/core';
import { hydrateGmailConnector } from '../gmail/connection.js';
import { hydrateSlackConnector, type SlackSecret } from '../slack/connection.js';
import { hydrateHttpConnector } from '../http/connection.js';
import { hydrateWebhookConnection } from '../webhook/connection.js';
import { hydrateRdbConnector } from '../rdb/connection.js';
import { hydrateOpenApiConnector } from '../openapi/connection.js';
import { hydrateMcpConnector } from '../mcp/connection.js';

type DesktopCore = Awaited<ReturnType<typeof createAxStudioCore>>;

export async function hydrateConnectorsForStartup(
  core: DesktopCore,
): Promise<SlackSecret | null> {
  const tolerateHydrationFailure = process.env.AX_E2E === '1';

  async function runStep<T>(label: string, step: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await step();
    } catch (err) {
      if (!tolerateHydrationFailure) throw err;
      console.warn(`[AX Studio] E2E: skipped ${label} hydration:`, err);
      return fallback;
    }
  }

  await runStep('gmail', () => hydrateGmailConnector(core.store, core.runtime), undefined);
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

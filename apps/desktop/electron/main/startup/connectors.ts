import { app } from 'electron';
import type { createAxStudioCore } from '@ax-studio/core';
import { hydrateGmailConnector } from '../gmail/connection.js';
import { hydrateSlackConnector, type SlackSecret } from '../slack/connection.js';
import { hydrateHttpConnector } from '../http/connection.js';
import { hydrateWebhookConnection } from '../webhook/connection.js';
import { hydrateRdbConnector } from '../rdb/connection.js';
import { hydrateOpenApiConnector } from '../openapi/connection.js';
import { isCredentialUnavailableError } from '../credential-store.js';

/** Stored on the connection when its saved credential can no longer be read. */
export { CREDENTIAL_UNAVAILABLE_ERROR } from '../connection-errors.js';
import { CREDENTIAL_UNAVAILABLE_ERROR } from '../connection-errors.js';

type DesktopCore = Awaited<ReturnType<typeof createAxStudioCore>>;

export async function hydrateConnectorsForStartup(
  core: DesktopCore,
): Promise<SlackSecret | null> {
  const tolerateHydrationFailure = !app.isPackaged && process.env.AX_E2E === '1';
  const savedMockMcp = core.store.getConnections().find((entry) => entry.connector === 'mcp');
  if (savedMockMcp?.connected) core.store.setConnection('mcp', false, savedMockMcp.config);

  // Each connector hydrates in isolation: one unreadable secret (DPAPI/keyring
  // change, truncated file) must not stop the app or the other connectors.
  async function runStep<T>(label: string, step: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await step();
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (tolerateHydrationFailure) {
        console.warn(`[AX Studio] E2E: skipped ${label} hydration:`, err);
        return fallback;
      }
      console.error(`[AX Studio] ${label} connector hydration failed`, { code });
      if (isCredentialUnavailableError(err)) markCredentialUnavailable(label);
      return fallback;
    }
  }

  function markCredentialUnavailable(connector: string): void {
    try {
      const saved = core.store.getConnections().find((entry) => entry.connector === connector);
      if (!saved) return;
      const config = saved.config && typeof saved.config === 'object' && !Array.isArray(saved.config)
        ? saved.config as Record<string, unknown>
        : {};
      core.store.setConnection(connector, false, { ...config, lastError: CREDENTIAL_UNAVAILABLE_ERROR });
    } catch (error) {
      console.error(`[AX Studio] could not record ${connector} credential failure`, error);
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
  return slackSecret;
}

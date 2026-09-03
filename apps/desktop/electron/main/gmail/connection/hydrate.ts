import {
  GmailConnector,
  buildGmailConnectorConfig,
  parseGmailConnectionConfig,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { getCredentialStore } from '../../credential-store.js';
import { getGoogleOAuthCredentials } from '../oauth.js';
import { gmailConnection } from './shared.js';
import { migrateLegacyGmailConnection } from './legacy.js';

export async function hydrateGmailConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  await migrateLegacyGmailConnection(store);

  const conn = gmailConnection(store);
  if (!conn?.connected || !conn.config) return;

  const record = parseGmailConnectionConfig(conn.config);
  if (!record) return;

  const credential = await getCredentialStore().get(record.credentialRef);
  if (!credential) {
    store.setConnection('gmail', false);
    return;
  }

  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  runtime.connectors.gmail = new GmailConnector(
    buildGmailConnectorConfig({
      clientId,
      clientSecret,
      credential,
      email: record.account || undefined,
    }),
  );
}

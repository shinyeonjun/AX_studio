import { parseGmailConnectionConfig, type WorkflowRuntime, type WorkflowStore } from '@ax-studio/core';
import { getCredentialStore } from '../../credential-store.js';
import { gmailConnection } from './shared.js';

export async function disconnectGmailOAuth(store: WorkflowStore, runtime: WorkflowRuntime) {
  const conn = gmailConnection(store);
  const record = parseGmailConnectionConfig(conn?.config);
  if (record) {
    await getCredentialStore().delete(record.credentialRef);
  }
  store.setConnection('gmail', false);
  delete runtime.connectors.gmail;
  return { ok: true as const };
}

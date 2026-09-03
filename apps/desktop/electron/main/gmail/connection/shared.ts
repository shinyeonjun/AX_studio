import type { WorkflowStore } from '@ax-studio/core';

export function gmailConnection(store: WorkflowStore) {
  return store.getConnections().find((connection) => connection.connector === 'gmail');
}

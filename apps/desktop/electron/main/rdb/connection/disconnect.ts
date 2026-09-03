import { type WorkflowRuntime, type WorkflowStore } from '@ax-studio/core';
import { deleteRdbConnectionString } from './secrets.js';

export async function disconnectRdb(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  await deleteRdbConnectionString();
  store.setConnection('rdb', false);
  runtime.setConnector('rdb', null);
}

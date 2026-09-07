import { expect, it } from 'vitest';
import { WorkspaceSourceIngestQueue } from './workspace-source-ingest-queue.js';
it('bounds pending ingestion and restores capacity after settlement', async () => {
  const queue = new WorkspaceSourceIngestQueue();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  for (let i = 0; i < 128; i++) queue.enqueue(String(i), () => held);
  try {
    expect(() => queue.enqueue('overflow', async () => {})).toThrow('workspace_source_queue_full');
    expect(() => queue.enqueue('0', async () => {})).not.toThrow();
  } finally { release(); await queue.waitForIdle(); }
  expect(() => queue.enqueue('next', async () => {})).not.toThrow();
  await queue.waitForIdle();
});

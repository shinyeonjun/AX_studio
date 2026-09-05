import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ReportCheckpointStore } from './checkpoints.js';

it('survives recreation, replaces atomically, and isolates sessions', () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-checkpoint-test-'));
  try {
    const store = new ReportCheckpointStore(root);
    store.write('session-a', '../execution', { version: 1, identity: 'input', status: 'running', stages: {} });
    store.write('session-a', '../execution', { version: 1, identity: 'input', status: 'failed', stages: {
      capture: { digest: 'contract', value: { rows: [{ id: 'row' }] } },
    } });
    expect(new ReportCheckpointStore(root).read('session-a', '../execution')).toMatchObject({ status: 'failed' });
    expect(store.read('session-b', '../execution')).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

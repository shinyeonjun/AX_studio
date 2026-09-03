import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { replayRepairCandidate } from '../repair.js';
import { candidate, seedHistory, workflowFixture } from './fixtures.js';

describe('historical repair replay', () => {
  it('blocks apply evidence when one historical snapshot cannot be read', async () => {
    const root = mkdtempSync(join(process.env.TEMP ?? process.cwd(), 'ax-repair-replay-missing-'));
    const { db, store } = await seedHistory(root, true);

    const replay = replayRepairCandidate(store, workflowFixture(), candidate, { snapshotRoot: root });

    expect(replay).toMatchObject({ status: 'unavailable', total: 0, passed: 0, failed: 0 });
    expect(replay.reason).toBe('historical_snapshot_unavailable');
    db.close?.();
  });
});

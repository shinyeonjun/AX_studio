import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { replayRepairCandidate } from '../repair.js';
import { candidate, seedHistory, workflowFixture } from './fixtures.js';

describe('historical repair replay', () => {
  it('passes every persisted historical example after a virtual source-column rename', async () => {
    const root = mkdtempSync(join(process.env.TEMP ?? process.cwd(), 'ax-repair-replay-'));
    const { db, store } = await seedHistory(root);

    const replay = replayRepairCandidate(store, workflowFixture(), candidate, { snapshotRoot: root });

    expect(replay).toMatchObject({ status: 'passed', total: 3, passed: 3, failed: 0 });
    expect(replay.cases).toHaveLength(3);
    expect(replay.cases.every((entry) => entry.pass)).toBe(true);
    expect(JSON.stringify(replay)).not.toContain('customer_count":10');
    db.close?.();
  });
});

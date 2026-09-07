import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseAsync } from '../../db.js';
import { WorkflowStore } from '../../workflow-store.js';
describe('workflow save durable reopen', () => {
  it('persists a committed workflow and can reopen it after the database closes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-studio-db-'));
    const filePath = join(directory, 'state.sqlite');
    try {
      const db = await createDatabaseAsync(filePath);
      const store = new WorkflowStore(db);
      store.saveWorkflow({ id: 'workflow-persisted', name: '영속성 테스트', goal: '커밋된 workflow를 다시 읽기', version: 1, trigger: { type: 'manual' }, steps: [], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {} });
      db.close?.();
      const reopened = await createDatabaseAsync(filePath);
      expect(new WorkflowStore(reopened).getWorkflow('workflow-persisted')?.name).toBe('영속성 테스트');
      reopened.close?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

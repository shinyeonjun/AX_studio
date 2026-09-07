import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';
import { removeSessionArtifacts } from './persistence.js';
import { ReportCheckpointStore } from '../../documents/reporting/checkpoints.js';

describe('workspace evidence retention', () => {
  it('rejects traversal and reserved shared directories before deleting anything', () => {
    for (const id of ['..', '.', '../elsewhere', 'report-checkpoints']) {
      expect(() => removeSessionArtifacts({} as any, {} as any, 'unused', id)).toThrow('invalid_workspace_session');
    }
  });
  it('removes only the deleted chats report checkpoints', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-checkpoint-gc-'));
    try {
      const checkpoints = new ReportCheckpointStore(join(root, 'report-checkpoints'));
      const checkpoint = { version: 1 as const, identity: 'audit', status: 'failed' as const, stages: {} };
      checkpoints.write('a', 'run', checkpoint); checkpoints.write('b', 'run', checkpoint);
      removeSessionArtifacts({ listWorkspaceSources: () => [] } as any, {} as any, root, 'a');
      expect(checkpoints.read('a', 'run')).toBeUndefined();
      expect(checkpoints.read('b', 'run')).toEqual(checkpoint);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('preserves artifacts referenced by retained discovery examples', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO work_discovery_sessions
        (id,status,revision,user_goal,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run('discovery', 'cancelled', 1, 'audit', '{}', now, now);
      store.insertDiscoveryExample({ sessionId: 'discovery', inputArtifactIds: ['input'], outputArtifactIds: ['output'] });
      expect(store.countWorkspaceSourcesForArtifact('input', 'deleted-chat')).toBeGreaterThan(0);
      expect(store.countWorkspaceSourcesForArtifact('output', 'deleted-chat')).toBeGreaterThan(0);
      expect(store.countWorkspaceSourcesForArtifact('unreferenced', 'deleted-chat')).toBe(0);
    } finally { db.close?.(); }
  });
});

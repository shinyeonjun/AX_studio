import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

  it('checks source, snapshot, and example references in one cleanup lookup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-source-reference-batch-'));
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO work_discovery_sessions
        (id,status,revision,user_goal,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run('discovery', 'cancelled', 1, 'audit', '{}', now, now);
      const example = store.insertDiscoveryExample({
        sessionId: 'discovery', inputArtifactIds: ['input'], outputArtifactIds: [],
      });
      const chat = store.saveWorkspaceChat({ messages: [] });
      const insertSource = (id: string, artifactId: string, documentArtifactId?: string) =>
        store.insertWorkspaceSource({
          id,
          sessionId: chat.id,
          artifactId,
          fileName: `${id}.pdf`,
          status: 'ready',
          documentArtifactId,
          createdAt: now,
          updatedAt: now,
        });
      insertSource('src_input', 'input', 'derived');
      insertSource('src_snapshot', 'snapshot');
      insertSource('src_orphan', 'orphan');
      db.prepare(`INSERT INTO work_discovery_snapshots
        (id,session_id,example_id,source_id,kind,artifact_id,fingerprint,captured_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run('snapshot', 'discovery', example.id, 'source', 'input', 'snapshot', 'fingerprint', now);

      const lookup = vi.spyOn(store, 'findReferencedWorkspaceSourceArtifacts');
      const removed: string[] = [];
      removeSessionArtifacts(store, { remove: (id: string) => removed.push(id) } as any, root, chat.id);

      expect(lookup).toHaveBeenCalledTimes(1);
      expect(removed.sort()).toEqual(['derived', 'orphan']);
    } finally {
      db.close?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps every candidate artifact when a discovery reference is malformed', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO work_discovery_sessions
        (id,status,revision,user_goal,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run('discovery', 'cancelled', 1, 'audit', '{}', now, now);
      const example = store.insertDiscoveryExample({
        sessionId: 'discovery', inputArtifactIds: [], outputArtifactIds: [],
      });
      db.prepare('UPDATE work_discovery_examples SET input_artifact_ids_json = ? WHERE id = ?')
        .run('{broken', example.id);

      expect([...store.findReferencedWorkspaceSourceArtifacts(['candidate', 'other'], 'deleted-chat')].sort())
        .toEqual(['candidate', 'other']);
    } finally { db.close?.(); }
  });

  it('finds artifact references beyond one SQLite-safe query batch', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const now = new Date().toISOString();
      const otherChat = store.saveWorkspaceChat({ messages: [] });
      store.insertWorkspaceSource({
        id: 'src_last_batch',
        sessionId: otherChat.id,
        artifactId: 'candidate-400',
        fileName: 'retained.pdf',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });
      const candidates = Array.from({ length: 401 }, (_, index) => `candidate-${index}`);

      expect([...store.findReferencedWorkspaceSourceArtifacts(candidates, 'deleted-chat')])
        .toEqual(['candidate-400']);
    } finally { db.close?.(); }
  });
});

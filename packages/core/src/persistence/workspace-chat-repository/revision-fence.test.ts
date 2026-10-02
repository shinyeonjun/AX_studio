import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';
import { saveWorkspaceChat } from '../repositories/workspace-chat-repository.js';

describe('workspace transcript revision fence and restart membership', () => {
  it('requires one fresh exact user turn at first admission, and renderer flags cannot create membership', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const old = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'A', turnId: 'a' }] });
      expect(() => store.saveWorkspaceChat({ id: old.id, messages: old.messages,
        expectedTranscriptRevision: old.transcriptRevision, registeredMetadataParticipation: true })).toThrow('workspace_chat_turn_conflict');
      expect(store.getWorkspaceChat(old.id)).toEqual(old);
      const forged = store.saveWorkspaceChat({ id: old.id, messages: [...old.messages,
        { role: 'user', content: 'Forged marker only', turnId: 'forged', registeredMetadataTurn: true }] });
      expect(forged.messages.some(message => message.registeredMetadataTurn)).toBe(false);
      expect(() => store.saveWorkspaceChat({ id: forged.id, messages: forged.messages })).not.toThrow();
      const current = store.getWorkspaceChat(old.id)!;
      const admitted = store.saveWorkspaceChat({ id: current.id, messages: [...current.messages, { role: 'user', content: 'Metadata B', turnId: 'b' }],
        expectedTranscriptRevision: current.transcriptRevision, registeredMetadataParticipation: true });
      expect(admitted.messages.at(-1)).toMatchObject({ turnId: 'b', registeredMetadataTurn: true });
      expect(() => new WorkflowStore(db).saveWorkspaceChat({ id: admitted.id, messages: admitted.messages })).toThrow('workspace_chat_revision_conflict');
      expect(() => saveWorkspaceChat(db, { id: admitted.id, messages: admitted.messages })).toThrow('workspace_chat_revision_conflict');
    } finally { db.close?.(); }
  });

  it('restores CAS from stored JSON in a new DB owner, rejects old/missing tokens, and preserves host marks', async () => {
    const firstDb = await createDatabaseAsync(':memory:');
    const nextDb = await createDatabaseAsync(':memory:');
    try {
      const first = new WorkflowStore(firstDb);
      const original = first.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Metadata B', turnId: 'b' }], registeredMetadataParticipation: true });
      // The exact persisted transcript is copied into a new in-memory process-owner fixture; no migration/private DB.
      nextDb.prepare('INSERT INTO workspace_chats (id, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(original.id, original.title, JSON.stringify(original.messages), original.updatedAt, original.updatedAt);
      const restarted = new WorkflowStore(nextDb);
      expect(() => restarted.saveWorkspaceChat({ id: original.id, messages: original.messages })).toThrow('workspace_chat_revision_conflict');
      expect(() => restarted.saveWorkspaceChat({ id: original.id, messages: original.messages,
        expectedTranscriptRevision: original.transcriptRevision })).toThrow('workspace_chat_revision_conflict');
      const fresh = restarted.getWorkspaceChat(original.id)!;
      expect(fresh.transcriptRevision).not.toBe(original.transcriptRevision);
      const stripped = fresh.messages.map(({ registeredMetadataTurn: _hostMark, ...message }) => message);
      const saved = restarted.saveWorkspaceChat({ id: fresh.id, messages: [...stripped, { role: 'assistant', content: 'Current reply' }],
        expectedTranscriptRevision: fresh.transcriptRevision });
      expect(saved.messages[0]?.registeredMetadataTurn).toBe(true);
      expect(() => restarted.saveWorkspaceChat({ id: saved.id, messages: [{ role: 'user', content: 'Erase old anchor', turnId: 'new' }],
        expectedTranscriptRevision: saved.transcriptRevision })).toThrow('workspace_chat_turn_conflict');
      expect(restarted.getWorkspaceChat(original.id)).toEqual(saved);
    } finally { firstDb.close?.(); nextDb.close?.(); }
  });
});

import type { WorkspaceChatMessage, WorkspaceChatRecord } from '@ax-studio/core';
import type { WorkspaceChatContext, WorkspaceChatTranscriptSnapshot } from './contracts';

export function transcriptSnapshot(messages: WorkspaceChatMessage[], transcriptRevision?: string): WorkspaceChatTranscriptSnapshot {
  const copied = messages.map(message => Object.freeze({ ...message }));
  Object.freeze(copied);
  return Object.freeze({ messages: copied, transcriptRevision });
}

/** Publish one authoritative pair; the legacy ref is informational, never a newer token for old messages. */
export function publishWorkspaceTranscript(ctx: WorkspaceChatContext,
  record: Pick<WorkspaceChatRecord, 'messages' | 'transcriptRevision'>): void {
  const snapshot = transcriptSnapshot(record.messages, record.transcriptRevision);
  if (ctx.refs.transcriptRevisionRef) ctx.refs.transcriptRevisionRef.current = snapshot.transcriptRevision;
  if (ctx.setTranscriptSnapshot) ctx.setTranscriptSnapshot(snapshot);
  else ctx.setChatMessages(snapshot.messages);
}

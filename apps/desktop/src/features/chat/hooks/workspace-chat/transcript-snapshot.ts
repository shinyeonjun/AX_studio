import type { WorkspaceChatMessage, WorkspaceChatRecord } from '@ax-studio/core';
import type { WorkspaceChatContext, WorkspaceChatTranscriptSnapshot } from './contracts';

export function transcriptSnapshot(
  messages: WorkspaceChatMessage[],
  transcriptRevision?: string,
  previous?: readonly WorkspaceChatMessage[],
): WorkspaceChatTranscriptSnapshot {
  const copied = messages.map((message, index) => {
    // An unchanged message keeps its object, so memoized message rows skip re-rendering.
    const before = previous?.[index];
    if (before && sameMessage(before, message)) return before;
    return Object.freeze({ ...message });
  });
  Object.freeze(copied);
  return Object.freeze({ messages: copied, transcriptRevision });
}

function sameMessage(left: WorkspaceChatMessage, right: WorkspaceChatMessage): boolean {
  return left === right || (left.role === right.role && left.content === right.content
    && JSON.stringify(left) === JSON.stringify(right));
}

/** Publish one authoritative pair; the legacy ref is informational, never a newer token for old messages. */
export function publishWorkspaceTranscript(ctx: WorkspaceChatContext,
  record: Pick<WorkspaceChatRecord, 'messages' | 'transcriptRevision'>): void {
  const snapshot = transcriptSnapshot(record.messages, record.transcriptRevision, ctx.transcriptSnapshot?.messages);
  if (ctx.refs.transcriptRevisionRef) ctx.refs.transcriptRevisionRef.current = snapshot.transcriptRevision;
  if (ctx.setTranscriptSnapshot) ctx.setTranscriptSnapshot(snapshot);
  else ctx.setChatMessages(snapshot.messages);
}

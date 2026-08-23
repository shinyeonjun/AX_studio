import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceExecutionMode } from '@ax-studio/core';

export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  kind: 'workspace';
  workflowId?: string;
  executionMode?: WorkspaceExecutionMode;
  corrupted?: boolean;
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);

  const refresh = useCallback(async () => {
    const list = (await window.ax.listChatSessions()) as ChatSessionSummary[];
    setSessions(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sessions, refreshSessions: refresh };
}

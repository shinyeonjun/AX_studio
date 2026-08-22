import { useCallback, useEffect, useState } from 'react';

export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  kind: 'workspace' | 'interview';
  workflowId?: string;
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

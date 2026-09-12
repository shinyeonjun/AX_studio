import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcErrorMessage } from '../../../ui/lib/ipc-error';

export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  kind: 'workspace';
  workflowId?: string;
  corrupted?: boolean;
  sourceCount?: number;
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [error, setError] = useState('');
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const list = (await window.ax.listChatSessions()) as ChatSessionSummary[];
      if (request !== latestRequest.current) return;
      setSessions(list);
      setError('');
    } catch (err) {
      if (request === latestRequest.current) {
        setError(ipcErrorMessage(err, '대화 목록을 불러오지 못했습니다.'));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sessions, error, refreshSessions: refresh };
}

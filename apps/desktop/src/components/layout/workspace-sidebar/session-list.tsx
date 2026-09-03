import type { ChatSessionSummary } from '../../../hooks/useChatSessions';
import { IconPlus, IconTrash } from '../../icons';

interface SidebarSessionListProps {
  sessions: ChatSessionSummary[];
  activeSessionId?: string;
  onNewChat: () => void;
  onSelectSession: (session: ChatSessionSummary) => void;
  onDeleteSession: (session: ChatSessionSummary) => void;
}

export function SidebarSessionList({
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: SidebarSessionListProps) {
  return (
    <div className="workspace-sidebar-sessions">
      <h2 className="sidebar-section-title">최근 대화</h2>
      <button type="button" className="sidebar-new-chat" onClick={onNewChat}>
        <IconPlus />
        새 대화
      </button>
      <ul className="sidebar-session-list scrollbar-overlay">
        {sessions.map((session) => (
          <li key={session.id} className="sidebar-session-row">
            <button
              type="button"
              className={'sidebar-session-item ' + (activeSessionId === session.id ? 'active' : '')}
              onClick={() => onSelectSession(session)}
            >
              <span className="sidebar-session-title">{session.title}</span>
              {session.sourceCount != null && session.sourceCount > 0 && (
                <span className="sidebar-session-tag">자료 {session.sourceCount}개</span>
              )}
            </button>
            <button
              type="button"
              className="sidebar-session-delete"
              onClick={() => onDeleteSession(session)}
              aria-label={session.title + ' 대화 삭제'}
              title="대화 삭제"
            >
              <IconTrash />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { ipcErrorMessage } from '../../../ui/lib/ipc-error';

interface ConnectionCardProps {
  title: string;
  description: string;
  badge: string;
  badgeClass?: string;
  icon?: string;
  emojiIcon?: string;
  /** Last connector error reported by the main process, shown under the description. */
  error?: string;
  onClick: () => void;
}

export function ConnectionCard({
  title,
  description,
  badge,
  badgeClass = '',
  icon,
  emojiIcon,
  error,
  onClick,
}: ConnectionCardProps) {
  return (
    <button type="button" className="connection-card" onClick={onClick}>
      {icon ? (
        <img src={icon} alt="" className="connection-card-icon" />
      ) : (
        <div className="connection-card-icon connection-card-icon-emoji" aria-hidden>
          {emojiIcon}
        </div>
      )}
      <div className="connection-card-body">
        <div className="connection-card-title-row">
          <div className="connection-card-title">{title}</div>
          <span className={`connection-badge ${badgeClass}`}>{badge}</span>
        </div>
        <div className="connection-card-desc">{description}</div>
        {error && <div className="connection-card-error">오류: {ipcErrorMessage(new Error(error), '연결에 문제가 있어요. 눌러서 설정을 확인해 주세요.')}</div>}
      </div>
    </button>
  );
}

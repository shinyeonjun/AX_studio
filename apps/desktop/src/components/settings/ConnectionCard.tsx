interface ConnectionCardProps {
  title: string;
  description: string;
  badge: string;
  badgeClass?: string;
  icon?: string;
  emojiIcon?: string;
  onClick: () => void;
}

export function ConnectionCard({
  title,
  description,
  badge,
  badgeClass = '',
  icon,
  emojiIcon,
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
        <div className="connection-card-title">{title}</div>
        <div className="connection-card-desc">{description}</div>
      </div>
      <span className={`connection-badge ${badgeClass}`}>{badge}</span>
    </button>
  );
}

interface ConnectedServiceItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
}

interface ConnectedServiceListProps {
  title: string;
  items: ConnectedServiceItem[];
  busy?: boolean;
  onEdit?: (id: string) => void;
  onDisconnect?: (id: string) => void;
}

export function ConnectedServiceList({
  title,
  items,
  busy = false,
  onEdit,
  onDisconnect,
}: ConnectedServiceListProps) {
  if (items.length === 0) return null;

  return (
    <div className="connected-service-list local-folder-list">
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="local-folder-item connected-service-item">
            <div className="local-folder-item-body">
              <div className="local-folder-item-title">{item.title}</div>
              {item.subtitle && <div className="local-folder-item-path">{item.subtitle}</div>}
              {item.meta && <div className="connected-service-item-meta">{item.meta}</div>}
            </div>
            <div className="connected-service-item-actions">
              {onEdit && (
                <button type="button" className="btn secondary" onClick={() => onEdit(item.id)} disabled={busy}>
                  수정
                </button>
              )}
              {onDisconnect && (
                <button
                  type="button"
                  className="btn secondary danger"
                  onClick={() => onDisconnect(item.id)}
                  disabled={busy}
                >
                  연결 해제
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

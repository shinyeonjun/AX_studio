interface StateBannerProps {
  loading?: boolean;
  stale?: boolean;
  error?: string;
  onRetry?: () => void;
}

export function StateBanner({ loading, stale, error, onRetry }: StateBannerProps) {
  if (!loading && !stale && !error) return null;

  if (loading) {
    return (
      <div className="state-banner state-banner--loading" role="status" aria-live="polite">
        앱 상태를 불러오는 중…
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-banner state-banner--error" role="alert">
        <span>{error}</span>
        {onRetry && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
            다시 시도
          </button>
        )}
      </div>
    );
  }

  if (stale) {
    return (
      <div className="state-banner state-banner--stale" role="status" aria-live="polite">
        최신 상태를 가져오지 못했습니다. 표시 중인 정보가 오래됐을 수 있습니다.
        {onRetry && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
            새로고침
          </button>
        )}
      </div>
    );
  }

  return null;
}

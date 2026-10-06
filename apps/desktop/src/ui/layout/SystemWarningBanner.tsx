import { useState } from 'react';
import type { AppState } from '../../types/app-state';

type SystemWarningKey = 'databaseBackendFallback' | 'credentialStorageWarning';

const SYSTEM_WARNING_COPY: Record<SystemWarningKey, string> = {
  databaseBackendFallback:
    '기본 데이터베이스 엔진을 불러오지 못해 임시 저장 방식으로 실행 중입니다. 앱이 갑자기 종료되면 최근 몇 초간의 변경이 저장되지 않을 수 있습니다. 앱을 다시 설치하거나 문제 해결 메뉴에서 진단 정보를 보내 주세요.',
  credentialStorageWarning:
    'OS 키링(Secret Service)을 사용할 수 없어 토큰·비밀번호가 암호화되지 않은 형태로 저장됩니다. gnome-keyring 또는 KWallet을 설치·잠금 해제한 뒤 앱을 다시 시작해 주세요.',
};

/** Active system-level warnings derived from app state, in display order. */
export function activeSystemWarnings(state: AppState | null): SystemWarningKey[] {
  if (!state) return [];
  const warnings: SystemWarningKey[] = [];
  if (state.databaseBackendFallback) warnings.push('databaseBackendFallback');
  if (state.credentialStorageWarning) warnings.push('credentialStorageWarning');
  return warnings;
}

/**
 * Dismissible warnings about degraded storage. Dismissal lasts for this app session only,
 * so a persisting problem is shown again after restart.
 */
export function SystemWarningBanner({ state }: { state: AppState | null }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<SystemWarningKey>>(() => new Set());
  const visible = activeSystemWarnings(state).filter((key) => !dismissed.has(key));
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((key) => (
        <div key={key} className="state-banner state-banner--stale" role="alert">
          <span>{SYSTEM_WARNING_COPY[key]}</span>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            aria-label="경고 닫기"
            onClick={() => setDismissed((current) => new Set(current).add(key))}
          >
            닫기
          </button>
        </div>
      ))}
    </>
  );
}

import { useState } from 'react';
import type { AppState } from '../../types/app-state';

type SystemWarningKey = 'databaseBackendFallback' | 'credentialStorageWarning';

const SYSTEM_WARNING_COPY: Record<SystemWarningKey, string> = {
  databaseBackendFallback:
    '기본 데이터베이스 엔진을 불러오지 못해 임시 저장 방식으로 실행 중입니다. 앱이 갑자기 종료되면 최근 몇 초간의 변경이 저장되지 않을 수 있습니다. 앱을 다시 설치하거나 문제 해결 메뉴에서 진단 정보를 보내 주세요.',
  credentialStorageWarning:
    '이 컴퓨터의 비밀번호 보관함을 쓸 수 없어 토큰·비밀번호가 암호화되지 않은 채 저장되고 있어요. 컴퓨터 관리자에게 비밀번호 보관함(키링) 설정을 요청한 뒤 앱을 다시 시작해 주세요.',
};

/** Active system-level warnings derived from app state, in display order. */
export function activeSystemWarnings(state: AppState | null): SystemWarningKey[] {
  if (!state) return [];
  const warnings: SystemWarningKey[] = [];
  if (state.databaseBackendFallback) warnings.push('databaseBackendFallback');
  if (state.credentialStorageWarning) warnings.push('credentialStorageWarning');
  return warnings;
}

function formatDetectedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR');
}

/** Number of stored rows skipped because they could not be parsed (0 when unknown). */
export function corruptRowCount(state: AppState | null): number {
  const total = state?.corruptRows?.total;
  return typeof total === 'number' && total > 0 ? total : 0;
}

/**
 * Notice that some stored rows were unreadable and skipped. Only identifiers, error codes
 * and detection times are listed; row payloads are never sent to the renderer.
 */
function CorruptRowsNotice({ summary, onDismiss }: { summary: NonNullable<AppState['corruptRows']>; onDismiss: () => void }) {
  const hidden = summary.total - summary.rows.length;
  return (
    <div className="state-banner state-banner--stale system-corrupt-rows" role="status">
      <div className="system-corrupt-rows-body">
        <span>손상된 데이터 {summary.total}건이 건너뛰어졌습니다. 해당 항목은 목록과 실행에서 제외됩니다.</span>
        <details className="system-corrupt-rows-details">
          <summary>자세히 보기</summary>
          <ul>
            {summary.rows.map((row) => (
              <li key={`${row.table}:${row.id}`}>
                <code>{row.table}</code> · <code>{row.id}</code> · {row.code} · {formatDetectedAt(row.detectedAt)}
              </li>
            ))}
          </ul>
          {hidden > 0 && <p>외 {hidden}건은 표시하지 않았습니다.</p>}
        </details>
      </div>
      <button type="button" className="btn btn-sm btn-secondary" aria-label="손상된 데이터 알림 닫기" onClick={onDismiss}>
        닫기
      </button>
    </div>
  );
}

/**
 * Dismissible warnings about degraded storage. Dismissal lasts for this app session only,
 * so a persisting problem is shown again after restart.
 */
export function SystemWarningBanner({ state }: { state: AppState | null }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<SystemWarningKey>>(() => new Set());
  // Dismissal remembers the count it hid, so newly detected corrupt rows show the notice again.
  const [dismissedCorruptCount, setDismissedCorruptCount] = useState(0);
  const visible = activeSystemWarnings(state).filter((key) => !dismissed.has(key));
  const corruptCount = corruptRowCount(state);
  const showCorruptRows = corruptCount > dismissedCorruptCount && state?.corruptRows;
  if (visible.length === 0 && !showCorruptRows) return null;

  return (
    <>
      {visible.map((key) => (
        <div key={key} className="state-banner state-banner--stale" role="status">
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
      {showCorruptRows && (
        <CorruptRowsNotice summary={showCorruptRows} onDismiss={() => setDismissedCorruptCount(corruptCount)} />
      )}
    </>
  );
}

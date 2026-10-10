import { useState } from 'react';
import type { AppState } from '../../types/app-state';

type SystemWarningKey = 'databaseBackendFallback' | 'credentialStorageWarning';

const SYSTEM_WARNING_COPY: Record<SystemWarningKey, string> = {
  databaseBackendFallback:
    '기본 데이터베이스 엔진을 불러오지 못해 임시 저장 방식으로 실행 중입니다. 앱이 갑자기 종료되면 최근 몇 초간의 변경이 저장되지 않을 수 있습니다. 계속되면 앱을 다시 설치해 주세요.',
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

/** Stored tables as the part of the app people know them by. */
const CORRUPT_AREA_LABELS: Record<string, string> = {
  approvals: '승인 요청',
  workflow_versions: '업무',
  workflow_repair_proposals: '업무 고침 제안',
  work_discovery_sessions: '업무 찾기 대화',
  work_discovery_examples: '업무 찾기 예시',
};

function corruptAreaLabel(table: string): string {
  return Object.hasOwn(CORRUPT_AREA_LABELS, table) ? CORRUPT_AREA_LABELS[table]! : '기타 데이터';
}

/** "업무 2건, 승인 요청 1건": the per-table counts merged by what people call each area. */
function corruptAreaCounts(byTable: Record<string, number>): string {
  const counts = new Map<string, number>();
  for (const [table, count] of Object.entries(byTable)) {
    if (typeof count !== 'number' || count <= 0) continue;
    const label = corruptAreaLabel(table);
    counts.set(label, (counts.get(label) ?? 0) + count);
  }
  return [...counts].map(([label, count]) => `${label} ${count}건`).join(', ');
}

/**
 * Notice that some stored rows were unreadable and skipped. People see how many items per area;
 * the identifiers, error codes and detection times stay folded away for a support request.
 * Row payloads are never sent to the renderer.
 */
function CorruptRowsNotice({ summary, onDismiss }: { summary: NonNullable<AppState['corruptRows']>; onDismiss: () => void }) {
  const hidden = summary.total - summary.rows.length;
  const areas = corruptAreaCounts(summary.byTable ?? {});
  return (
    <div className="state-banner state-banner--stale system-corrupt-rows" role="status">
      <div className="system-corrupt-rows-body">
        <span>
          손상된 데이터 {summary.total}건{areas ? `(${areas})` : ''}을 읽지 못해 목록과 실행에서 제외했습니다.
          계속되면 아래 상세 정보를 지원팀에 전달해 주세요.
        </span>
        <details className="system-corrupt-rows-details">
          <summary>지원팀에 보낼 상세 정보</summary>
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

export interface WorkspaceReviewActions {
  busy: boolean;
  isLinkedWork: boolean;
  isImmediateOnce: boolean;
  isDeferredOnce: boolean;
  isRecurringDraft: boolean;
  allowExternalAuto: boolean;
  approvalGateCount: number;
  highRiskGateCount: number;
  onAllowExternalAutoChange: (value: boolean) => void;
  onRunOnce: () => void;
  onSaveAsWork: () => void;
}

interface WorkspaceReviewCardProps {
  actions: WorkspaceReviewActions;
}

export function WorkspaceReviewCard({ actions }: WorkspaceReviewCardProps) {
  const {
    busy,
    isLinkedWork,
    isImmediateOnce,
    isDeferredOnce,
    isRecurringDraft,
    allowExternalAuto,
    approvalGateCount,
    highRiskGateCount,
    onAllowExternalAutoChange,
    onRunOnce,
    onSaveAsWork,
  } = actions;

  return (
    <div className="ax-workspace-review-card" role="region" aria-label="업무 검토">
      <p className="ax-workspace-review-title">{isLinkedWork ? '변경사항을 검토하세요' : '설계가 완료됐습니다'}</p>
      <p className="ax-workspace-review-copy">
        오른쪽 그래프를 확인한 뒤 {isLinkedWork ? '변경사항을 저장하거나 테스트 실행하세요.' : 'workflow.json을 저장하거나 실행하세요.'}
      </p>
      {(approvalGateCount > 0 || highRiskGateCount > 0) && (
        <div className="ax-workspace-review-gates">
          <p className="ax-workspace-review-gates-title">승인 게이트</p>
          <ul className="ax-workspace-review-gates-list">
            {approvalGateCount > 0 && (
              <li>
                EXTERNAL 작업 {approvalGateCount}개 — 기본 승인 필요
                {allowExternalAuto ? ' (자동 실행 허용됨)' : ''}
              </li>
            )}
            {highRiskGateCount > 0 && <li>EXTERNAL_HIGH 작업 {highRiskGateCount}개 — 항상 승인 필요</li>}
          </ul>
          <label className="ax-workspace-review-toggle">
            <input
              type="checkbox"
              checked={allowExternalAuto}
              disabled={busy}
              onChange={(event) => onAllowExternalAutoChange(event.target.checked)}
            />
            EXTERNAL 작업 자동 실행 허용 (HIGH는 완화되지 않음)
          </label>
        </div>
      )}
      <div className="ax-workspace-review-actions">
        {isLinkedWork ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onSaveAsWork} disabled={busy}>
              변경사항 저장
            </button>
            <button type="button" className="btn" onClick={onRunOnce} disabled={busy}>
              테스트 실행
            </button>
          </>
        ) : isDeferredOnce ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onSaveAsWork} disabled={busy}>
              workflow.json 저장
            </button>
            <button type="button" className="btn" onClick={onRunOnce} disabled={busy}>
              지금 바로 실행
            </button>
          </>
        ) : isImmediateOnce ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onRunOnce} disabled={busy}>
              한 번만 실행
            </button>
            <button type="button" className="btn" onClick={onSaveAsWork} disabled={busy}>
              workflow.json 저장
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onRunOnce} disabled={busy}>
              테스트 실행
            </button>
            <button type="button" className="btn btn-primary" onClick={onSaveAsWork} disabled={busy}>
              {isRecurringDraft ? 'workflow.json 저장' : '업무로 저장'}
            </button>
          </>
        )}
      </div>
      {!isLinkedWork && (
        <p className="ax-workspace-review-note muted">
          저장된 업무는 기본 비활성(disabled)입니다. 사이드바에서 활성화한 뒤 trigger가 동작합니다.
        </p>
      )}
    </div>
  );
}

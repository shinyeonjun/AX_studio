import type { AppState } from '../../types/app-state';
import {
  executionErrorLabel,
  executionStatusLabel,
  executionTriggerLabel,
  formatRelativeTime,
} from '../../lib/work-display';
import { formatFileSize, formatTimestamp } from './format.js';

type ActivityExecution = AppState['executions'][number];

export function ActivityExecutionItem({
  execution,
  skillName,
  deleting,
  clearing,
  exporting,
  isExporting,
  exported,
  exportError,
  savingToFolder,
  isSavingToFolder,
  savedToFolder,
  folderSaveError,
  onDelete,
  onExportPdf,
  onSavePdfToFolder,
}: {
  execution: ActivityExecution;
  skillName?: string;
  deleting: boolean;
  clearing: boolean;
  exporting: boolean;
  isExporting: boolean;
  exported: boolean;
  exportError?: string;
  savingToFolder: boolean;
  isSavingToFolder: boolean;
  savedToFolder: boolean;
  folderSaveError?: string;
  onDelete: () => void;
  onExportPdf: (artifactId: string) => void;
  onSavePdfToFolder: (artifactId: string) => void;
}) {
  const resultFailed = execution.resultStatus === 'failed';
  const ok = execution.status === 'success' && !resultFailed;
  const running = execution.status === 'running';
  const pending = execution.status === 'pending_approval';
  const failed = execution.status === 'failed';
  const errorDetail = executionErrorLabel(execution.errorCode);
  const generatedPdf = execution.generatedPdf;

  return (
    <div className="timeline-item">
      <div
        className={`timeline-dot ${ok ? 'success' : failed ? 'failed' : pending ? 'pending' : running ? 'running' : ''}`}
      >
        {ok ? '✓' : failed ? '!' : pending ? '!' : running ? '…' : '·'}
      </div>
      <div className="timeline-body">
        <div className="timeline-body-header">
          <div className="timeline-time">
            {formatRelativeTime(execution.startedAt)} · {formatTimestamp(execution.startedAt)}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-danger-text timeline-delete"
            onClick={onDelete}
            disabled={deleting || clearing}
            aria-label="기록 삭제"
            title="기록 삭제"
          >
            {deleting ? '…' : '삭제'}
          </button>
        </div>
        <div className="timeline-status">
          {skillName ?? '일회 실행'} — {resultFailed ? '결과 품질 실패' : executionStatusLabel(execution.status)}
        </div>
        <div className="muted">
          {executionTriggerLabel(execution.triggerType)}
          {resultFailed ? ' · 기술 실행 완료 · 결과 품질 차단' : ''}
          {errorDetail ? ` · ${errorDetail}` : ''}
          {execution.errorMessage && execution.errorMessage !== errorDetail ? ` · ${execution.errorMessage}` : ''}
        </div>
        {execution.currentStepId && (
          <div className="timeline-step">
            현재 단계 · {execution.currentStepId}
            {execution.currentStepMessage ? ` · ${execution.currentStepMessage}` : ''}
          </div>
        )}
        {execution.lastLogMessage && !execution.currentStepMessage && (
          <div className="timeline-step">최근 기록 · {execution.lastLogMessage}</div>
        )}
        {execution.aiOutput && (
          <div className="timeline-step">
            AI 분석 결과 · {execution.aiOutput.fields.length > 0 ? execution.aiOutput.fields.join(', ') : '출력 없음'}
            {Object.entries(execution.aiOutput.preview).map(([field, value]) => (
              <div key={field}>
                {field}: {value || '(빈 값)'}
              </div>
            ))}
          </div>
        )}
        {generatedPdf && (
          <div className="generated-pdf" data-testid="generated-pdf">
            <div className="generated-pdf-copy">
              <span className="generated-pdf-eyebrow">생성된 파일 · PDF</span>
              <div className="generated-pdf-name" title={generatedPdf.fileName}>
                {generatedPdf.fileName}
              </div>
              <div className="generated-pdf-size">{formatFileSize(generatedPdf.size)}</div>
            </div>
            <div className="generated-pdf-action" aria-live="polite">
              <div className="generated-pdf-buttons">
                <button
                  type="button"
                  className="btn btn-sm generated-pdf-button"
                  onClick={() => onExportPdf(generatedPdf.artifactId)}
                  disabled={exporting || savingToFolder || deleting || clearing}
                  aria-label={`${generatedPdf.fileName} PDF 다운로드`}
                >
                  {isExporting ? '다운로드 중…' : exported ? '다운로드됨' : '다운로드'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm generated-pdf-button"
                  onClick={() => onSavePdfToFolder(generatedPdf.artifactId)}
                  disabled={exporting || savingToFolder || deleting || clearing}
                  aria-label={`${generatedPdf.fileName} 지정 폴더에 저장`}
                >
                  {isSavingToFolder ? '저장 중…' : savedToFolder ? '폴더에 저장됨' : '지정 폴더에 저장'}
                </button>
              </div>
              {(exportError || folderSaveError) && (
                <div className="generated-pdf-error" role="alert">
                  {exportError ?? folderSaveError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

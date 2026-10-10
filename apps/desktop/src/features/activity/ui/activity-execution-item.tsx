import type { AppState } from '../../../types/app-state';
import {
  executionErrorLabel,
  executionStatusLabel,
  executionStepLabel,
  executionTriggerLabel,
  formatRelativeTime,
} from '../../../ui/lib/work-display';
import { formatFileSize, formatTimestamp } from './format.js';
import { CalculatedOutput } from './calculated-output.js';

type ComputedResult = NonNullable<ActivityExecution['computedResults']>[number];

export function ComputedResults({ sourceFile, results }: { sourceFile?: string; results: ComputedResult[] }) {
  return (
    <div className="timeline-results" data-testid="computed-results">
      {sourceFile && <div className="timeline-step">읽은 파일 · {sourceFile}</div>}
      {results.filter((result) => result.kind === 'value').length > 0 && (
        <dl className="timeline-result-values">
          {results.flatMap((result, index) => result.kind === 'value'
            ? [<div key={index}><dt>{result.label}</dt><dd>{result.value}</dd></div>]
            : [])}
        </dl>
      )}
      {results.flatMap((result, index) => result.kind === 'table' ? [(
        <div key={index} className="timeline-result-table">
          <div className="timeline-step">{result.label}{result.totalRows > result.rows.length ? ` (${result.totalRows}행 중 ${result.rows.length}행)` : ''}</div>
          <table>
            <thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )] : [])}
    </div>
  );
}

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
  onExportFile,
  onSaveFileToFolder,
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
  onExportFile: (artifactId: string) => void;
  onSaveFileToFolder: (artifactId: string) => void;
}) {
  const resultFailed = execution.resultStatus === 'failed';
  const ok = execution.status === 'success' && !resultFailed;
  const running = execution.status === 'running';
  const pending = execution.status === 'pending_approval';
  const failed = execution.status === 'failed';
  const errorDetail = executionErrorLabel(execution.errorCode);
  const generatedFile = execution.generatedFile;
  const aiOutput = execution.aiOutput;
  // Field keys are internal names; show the work's own description, or just their place.
  const aiFieldLabel = (field: string, index: number) => aiOutput?.labels?.[field] ?? `항목 ${index + 1}`;

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
            // Running or approval-waiting runs cannot be deleted; say so here, not in a banner far above.
            disabled={deleting || clearing || running || pending}
            aria-label="기록 삭제"
            title={running || pending ? '실행이 끝난 뒤 삭제할 수 있어요' : '기록 삭제'}
          >
            {deleting ? '…' : '삭제'}
          </button>
        </div>
        <div className="timeline-status">
          {skillName ?? '일회성 작업'} — {resultFailed ? '실행은 끝났지만 결과를 확인해야 해요' : executionStatusLabel(execution.status)}
        </div>
        <div className="muted">
          {executionTriggerLabel(execution.triggerType)}
          {errorDetail ? ` · ${errorDetail}` : ''}
          {execution.errorMessage && execution.errorMessage.replace(/[.。]$/u, '') !== errorDetail ? ` · ${execution.errorMessage}` : ''}
        </div>
        {Boolean(execution.historyDiagnostics?.length) && (
          <div className="timeline-step" role="alert">
            이전 기록을 완전히 읽을 수 없습니다. 원본은 보존되어 있습니다.
          </div>
        )}
        {/* Which step it is on matters while it runs or after it stops; a finished run shows its result. */}
        {execution.currentStepId && !ok && (
          <div className="timeline-step">
            현재 단계 · {execution.currentStepMessage ?? executionStepLabel(execution.currentStepNumber)}
          </div>
        )}
        {ok && (execution.sourceFile || execution.computedResults?.length) && (
          <ComputedResults sourceFile={execution.sourceFile} results={execution.computedResults ?? []} />
        )}
        {execution.lastLogMessage && !execution.currentStepMessage && !ok && (
          <div className="timeline-step">최근 기록 · {execution.lastLogMessage}</div>
        )}
        {aiOutput && (
          <div className="timeline-step">
            AI 분석 결과 · {aiOutput.fields.length > 0 ? aiOutput.fields.map(aiFieldLabel).join(', ') : '출력 없음'}
            {Object.entries(aiOutput.preview).map(([field, value]) => {
              const index = aiOutput.fields.indexOf(field);
              return (
                <div key={field}>
                  {aiFieldLabel(field, index >= 0 ? index : aiOutput.fields.length)}: {value || '(빈 값)'}
                </div>
              );
            })}
          </div>
        )}
        {ok && execution.hasOutput && <CalculatedOutput key={execution.id} executionId={execution.id} />}
        {generatedFile && (
          <div className="generated-file" data-testid="generated-file">
            <div className="generated-file-copy">
              <span className="generated-file-eyebrow">생성된 파일 · {generatedFile.label}</span>
              <div className="generated-file-name" title={generatedFile.fileName}>
                {generatedFile.fileName}
              </div>
              <div className="generated-file-size">{formatFileSize(generatedFile.size)}</div>
            </div>
            <div className="generated-file-action" aria-live="polite">
              <div className="generated-file-buttons">
                <button
                  type="button"
                  className="btn btn-sm generated-file-button"
                  onClick={() => onExportFile(generatedFile.artifactId)}
                  disabled={exporting || savingToFolder || deleting || clearing}
                  aria-label={`${generatedFile.fileName} 다운로드`}
                >
                  {isExporting ? '다운로드 중…' : exported ? '다운로드됨' : '다운로드'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm generated-file-button"
                  onClick={() => onSaveFileToFolder(generatedFile.artifactId)}
                  disabled={exporting || savingToFolder || deleting || clearing}
                  aria-label={`${generatedFile.fileName} 지정 폴더에 저장`}
                >
                  {isSavingToFolder ? '저장 중…' : savedToFolder ? '폴더에 저장됨' : '지정 폴더에 저장'}
                </button>
              </div>
              {(exportError || folderSaveError) && (
                <div className="generated-file-error" role="alert">
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

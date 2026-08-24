import type { WorkspaceSourceRecord } from '@ax-studio/core';

interface WorkspaceSourcesPanelProps {
  sources: WorkspaceSourceRecord[];
  busy: boolean;
  onAttach: () => Promise<void>;
}

function statusLabel(source: WorkspaceSourceRecord): string {
  if (source.status === 'processing') return '분석 중';
  if (source.status === 'failed') return '분석 실패';
  return '분석 완료';
}

export function WorkspaceSourcesPanel({ sources, busy, onAttach }: WorkspaceSourcesPanelProps) {
  return (
    <section className="workspace-sources-panel" aria-label="대화 자료">
      <div className="workspace-sources-header">
        <div>
          <div className="workspace-sources-kicker">이 대화의 자료</div>
          <h2 className="workspace-sources-title">PDF 자료</h2>
          <p className="workspace-sources-subtitle">
            업로드한 파일은 이 대화에만 연결되고, 문서 엔진이 읽은 결과를 AI가 필요할 때 조회합니다.
          </p>
        </div>
        <button
          type="button"
          className="workspace-sources-add"
          disabled={busy}
          onClick={() => void onAttach()}
        >
          {busy ? '분석 중…' : '자료 추가'}
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="workspace-sources-empty">
          <span className="workspace-sources-empty-icon" aria-hidden="true">＋</span>
          <p>아직 이 대화에 올린 자료가 없습니다.</p>
          <span>자료를 추가하면 PDF는 Docling으로 분석됩니다.</span>
        </div>
      ) : (
        <ul className="workspace-sources-list">
          {sources.map((source) => (
            <li key={source.id} className={`workspace-source-item workspace-source-item--${source.status}`}>
              <div className="workspace-source-icon" aria-hidden="true">PDF</div>
              <div className="workspace-source-body">
                <div className="workspace-source-name" title={source.fileName}>{source.fileName}</div>
                <div className="workspace-source-meta">
                  <span className={`workspace-source-status workspace-source-status--${source.status}`}>
                    {statusLabel(source)}
                  </span>
                  {source.summary && (
                    <span>{source.summary.pageCount}페이지 · {source.engine ?? source.summary.engine}</span>
                  )}
                </div>
                {source.status === 'failed' && source.errorMessage && (
                  <div className="workspace-source-error">{source.errorMessage}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

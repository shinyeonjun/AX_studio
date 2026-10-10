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

/** The badge names the file's own kind: "report.docx" is Word, not PDF. */
function kindLabel(fileName: string): string {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'docx') return 'Word';
  return extension ? extension.toUpperCase().slice(0, 4) : '파일';
}

export function WorkspaceSourcesPanel({ sources, busy, onAttach }: WorkspaceSourcesPanelProps) {
  return (
    <section className="workspace-sources-panel" aria-label="대화 자료">
      <div className="workspace-sources-header">
        <div>
          <h2 className="workspace-sources-title">올린 자료</h2>
          <p className="workspace-sources-subtitle">이 대화에서만 쓰여요.</p>
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
          <span>PDF나 Word 파일을 올리면 내용을 읽어 대화에 씁니다.</span>
        </div>
      ) : (
        <ul className="workspace-sources-list">
          {sources.map((source) => (
            <li key={source.id} className={`workspace-source-item workspace-source-item--${source.status}`}>
              <div className={`workspace-source-icon${kindLabel(source.fileName) === 'Word' ? ' workspace-source-icon--word' : ''}`} aria-hidden="true">
                {kindLabel(source.fileName)}
              </div>
              <div className="workspace-source-body">
                <div className="workspace-source-name" title={source.fileName}>{source.fileName}</div>
                <div className="workspace-source-meta">
                  <span className={`workspace-source-status workspace-source-status--${source.status}`}>
                    {statusLabel(source)}
                  </span>
                  {source.summary && (
                    <span>{source.summary.pageCount}페이지</span>
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

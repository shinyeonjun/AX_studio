import { ConnectionGuide } from '../ConnectionGuide';
import {
  useLocalFolderConnectionForm,
  type LocalFolderConnectionFormProps,
} from './local-folder-connection/use-local-folder-connection-form';

export function LocalFolderConnectionForm({
  state,
  embedded = false,
  onPickFolder,
  onAddFolder,
  onRemoveFolder,
}: LocalFolderConnectionFormProps) {
  const {
    labelDraft,
    setLabelDraft,
    selectedPath,
    busy,
    message,
    folders,
    connected,
    handlePick,
    handleAdd,
    handleRemove,
  } = useLocalFolderConnectionForm({ state, onPickFolder, onAddFolder, onRemoveFolder });

  return (
    <div className={embedded ? 'settings-panel' : 'connection-detail'}>
      <div className={`settings-section connection-form ${embedded ? 'connection-form-compact' : ''}`}>
        <div className="connection-form-header">
          <div className="connection-form-icon connection-form-icon-emoji" aria-hidden>
            📁
          </div>
          <div>
            <h3>로컬 폴더 연결</h3>
            <p className="muted">
              PDF·문서를 매번 업로드하지 않고, 연결한 폴더의 파일을 업무에서 읽을 수 있습니다.
            </p>
          </div>
          <span className={`connection-badge ${connected ? 'connected' : ''}`}>
            {connected ? `${folders.length}개 연결됨` : '미연결'}
          </span>
        </div>

        <div className="form-field">
          <label htmlFor="local-folder-label">표시 이름 (선택)</label>
          <input
            id="local-folder-label"
            type="text"
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            placeholder="예: 업무 문서함"
            disabled={busy}
          />
        </div>

        <div className="form-field">
          <label htmlFor="local-folder-path">폴더 경로</label>
          <div className="local-folder-path-row">
            <input id="local-folder-path" type="text" value={selectedPath} readOnly placeholder="폴더를 선택하세요" />
            <button type="button" className="btn secondary" onClick={() => void handlePick()} disabled={busy}>
              찾아보기
            </button>
          </div>
        </div>

        <div className="connection-form-footer">
          <button type="button" className="btn primary" onClick={() => void handleAdd()} disabled={busy || !selectedPath}>
            {busy ? '처리 중…' : '폴더 연결 추가'}
          </button>
        </div>

        {message && (
          <p className={`connection-form-message ${message.includes('실패') ? 'error' : ''}`}>{message}</p>
        )}

        {folders.length > 0 && (
          <div className="local-folder-list">
            <h4>연결된 폴더</h4>
            <ul>
              {folders.map((folder) => (
                <li key={folder.id} className="local-folder-item">
                  <div className="local-folder-item-body">
                    <div className="local-folder-item-title">{folder.label}</div>
                    <div className="local-folder-item-path">{folder.path}</div>
                  </div>
                  <button
                    type="button"
                    className="btn secondary danger"
                    onClick={() => void handleRemove(folder.id)}
                    disabled={busy}
                  >
                    제거
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!embedded && (
        <ConnectionGuide
          guideKey="local_folder"
          placeholderName="로컬 폴더 연결 가이드"
          steps="1) 찾아보기로 폴더 선택 → 2) 연결 추가 → 3) 워크플로우에서 연결 폴더의 파일 경로로 document.ingest 또는 local_folder.read 호출. NAS·클라우드는 이후 같은 방식으로 확장 예정."
        />
      )}
    </div>
  );
}

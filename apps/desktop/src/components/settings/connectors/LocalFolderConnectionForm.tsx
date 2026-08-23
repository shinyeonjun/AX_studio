import { useState } from 'react';
import type { AppState } from '../../../types/app-state';
import { ConnectionGuide } from '../ConnectionGuide';
import { confirmRemoveLocalFolder } from '../../../lib/confirm-delete';

interface LocalFolderConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onPickFolder: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onAddFolder: (payload: { path: string; label?: string }) => Promise<void>;
  onRemoveFolder: (folderId: string) => Promise<void>;
}

export function LocalFolderConnectionForm({
  state,
  embedded = false,
  onPickFolder,
  onAddFolder,
  onRemoveFolder,
}: LocalFolderConnectionFormProps) {
  const [labelDraft, setLabelDraft] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const folders = state?.localFolders ?? [];
  const connected = folders.length > 0;

  const handlePick = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await onPickFolder();
      if (result.canceled) return;
      if (!result.ok || !result.path) {
        setMessage('폴더 선택이 취소되었습니다.');
        return;
      }
      setSelectedPath(result.path);
      if (!labelDraft.trim()) {
        const parts = result.path.replace(/\\/g, '/').split('/');
        setLabelDraft(parts[parts.length - 1] ?? result.path);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '폴더 선택에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!selectedPath) {
      setMessage('먼저 폴더를 선택해 주세요.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await onAddFolder({ path: selectedPath, label: labelDraft.trim() || undefined });
      setMessage('폴더가 연결되었습니다.');
      setSelectedPath('');
      setLabelDraft('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '폴더 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (folderId: string) => {
    const folder = folders.find((entry) => entry.id === folderId);
    if (!folder) return;
    if (!confirmRemoveLocalFolder(folder.label, folder.path)) return;

    setBusy(true);
    setMessage('');
    try {
      await onRemoveFolder(folderId);
      setMessage('폴더 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '폴더 연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

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
              PDF·문서를 매번 업로드하지 않고, 연결한 폴더의 파일을 워크플로우에서 읽을 수 있습니다.
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

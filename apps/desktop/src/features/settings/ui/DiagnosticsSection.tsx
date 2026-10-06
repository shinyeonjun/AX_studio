import { useState } from 'react';
import { SettingsCategory } from './SettingsCategory';
import { ipcErrorMessage } from '../../../ui/lib/ipc-error';

/** Support entry: export a redacted diagnostics bundle or open the log folder. */
export function DiagnosticsSection() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const exportDiagnostics = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.ax.exportDiagnostics();
      if (result.ok) setMessage(`저장했습니다: ${result.path}`);
      else if ('error' in result) setMessage(`내보내기 실패: ${result.error}`);
    } catch (err) {
      setMessage(`내보내기 실패: ${ipcErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const openLogFolder = async () => {
    setMessage(null);
    try {
      const result = await window.ax.openLogFolder();
      if (!result.ok) setMessage(`로그 폴더를 열지 못했습니다: ${result.error}`);
    } catch (err) {
      setMessage(`로그 폴더를 열지 못했습니다: ${ipcErrorMessage(err)}`);
    }
  };

  return (
    <SettingsCategory
      title="문제 해결"
      description="토큰·비밀번호·이메일은 가린 로그와 앱 버전 정보를 파일로 저장해 전달할 수 있습니다."
    >
      <div className="diagnostics-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={() => void exportDiagnostics()} disabled={busy}>
          {busy ? '내보내는 중…' : '진단 정보 내보내기'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void openLogFolder()}>
          로그 폴더 열기
        </button>
      </div>
      {message && <p className="muted" role="status">{message}</p>}
    </SettingsCategory>
  );
}

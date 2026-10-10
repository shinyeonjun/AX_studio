import { useState } from 'react';
import { SettingsCategory } from './SettingsCategory';
import { SettingRow } from './SettingRow';
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
      else if ('error' in result) setMessage(`내보내기 실패: ${ipcErrorMessage(new Error(result.error))}`);
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
      if (!result.ok) setMessage(`로그 폴더를 열지 못했습니다: ${ipcErrorMessage(new Error(result.error))}`);
    } catch (err) {
      setMessage(`로그 폴더를 열지 못했습니다: ${ipcErrorMessage(err)}`);
    }
  };

  return (
    <SettingsCategory title="문제 해결">
      <SettingRow
        title="진단 정보"
        description="문제가 생기면 로그와 앱 버전 정보를 파일로 저장해 전달할 수 있어요. 토큰·비밀번호·이메일은 가려서 저장합니다."
        control={(
          <div className="setting-row-buttons">
            <button type="button" className="btn btn-secondary" onClick={() => void openLogFolder()}>
              로그 폴더 열기
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void exportDiagnostics()} disabled={busy}>
              {busy ? '내보내는 중…' : '진단 정보 내보내기'}
            </button>
          </div>
        )}
      />
      {message && <p className="setting-row-message" role="status">{message}</p>}
    </SettingsCategory>
  );
}

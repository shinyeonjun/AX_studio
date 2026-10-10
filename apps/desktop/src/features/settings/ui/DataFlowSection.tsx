import { useEffect, useState } from 'react';
import { ipcErrorMessage } from '../../../ui/lib/ipc-error';
import { SettingsCategory } from './SettingsCategory';
import { SettingRow, SettingSwitch } from './SettingRow';

/** The one data setting people change: keep recurring work's content on this computer. */
export function DataFlowSection() {
  const [keepLocal, setKeepLocal] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.ax.getKeepContentLocal?.().then((value) => { if (active) setKeepLocal(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (keepLocal === null) return null;
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await window.ax.setKeepContentLocal?.(enabled);
      if (typeof saved === 'boolean') setKeepLocal(saved);
    } catch (err) {
      setMessage(`바꾸지 못했습니다: ${ipcErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCategory title="개인정보">
      <SettingRow
        title="반복 업무 내용은 이 컴퓨터 밖으로 보내지 않기"
        description="켜면 메일·문서 내용이 필요한 판단은 이 컴퓨터의 AI(Ollama)로만 실행해요."
        control={(
          <SettingSwitch
            label="반복 업무의 메일·문서·조회 내용을 이 컴퓨터 밖으로 보내지 않기"
            checked={keepLocal}
            disabled={busy}
            onChange={(checked) => void toggle(checked)}
          />
        )}
      />
      {message && <p className="setting-row-message" role="status">{message}</p>}
    </SettingsCategory>
  );
}

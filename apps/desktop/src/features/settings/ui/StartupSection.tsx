import { useEffect, useState } from 'react';
import type { StartAtLogin } from '../../../types/ax-api/runtime';
import { ipcErrorMessage } from '../../../ui/lib/ipc-error';
import { SettingsCategory } from './SettingsCategory';
import { SettingRow, SettingSwitch } from './SettingRow';

/**
 * Recurring work runs only while the app is running. Starting it, in the tray, when the person
 * signs in keeps schedules on time after the computer restarts.
 */
export function StartupSection() {
  const [setting, setSetting] = useState<StartAtLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.ax.getStartAtLogin?.().then((current) => { if (active) setSetting(current); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!setting?.supported) return null;
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await window.ax.setStartAtLogin?.(enabled);
      if (next) setSetting(next);
    } catch (err) {
      setMessage(`바꾸지 못했습니다: ${ipcErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCategory title="시작">
      <SettingRow
        title="컴퓨터를 켜면 AX Studio 자동으로 시작"
        description="반복 업무는 AX Studio가 켜져 있을 때만 실행됩니다. 켜 두면 창 없이 트레이에서 시작해서, 컴퓨터를 다시 켠 뒤에도 제때 실행돼요."
        control={(
          <SettingSwitch
            label="컴퓨터를 켜면 AX Studio 자동으로 시작"
            checked={setting.enabled}
            disabled={busy}
            onChange={(checked) => void toggle(checked)}
          />
        )}
      />
      {message && <p className="setting-row-message" role="status">{message}</p>}
    </SettingsCategory>
  );
}

import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../types/ax-api/runtime';

/**
 * Said once a newer version has been downloaded. Downloading itself stays quiet. Restarting is the
 * person's choice: otherwise the update is applied the next time the app is closed.
 */
export function UpdateNotice() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let active = true;
    void window.ax.getUpdateStatus?.().then((current) => { if (active) setStatus(current); }).catch(() => undefined);
    const off = window.ax.onUpdateStatus?.((next) => setStatus(next));
    return () => { active = false; off?.(); };
  }, []);

  if (status?.state !== 'ready' || dismissed) return null;
  const restart = async () => {
    setRestarting(true);
    const started = await window.ax.installUpdate?.().catch(() => false);
    if (!started) setRestarting(false);
  };
  return (
    <div className="state-banner" role="status">
      <span>
        새 버전({status.version})이 준비됐어요. 지금 다시 시작하면 바로 적용되고, 아니면 다음에 앱을 끌 때 적용돼요.
        실행 중인 업무가 있으면 끝난 뒤에 다시 시작해 주세요.
      </span>
      <button type="button" className="btn btn-sm btn-primary" disabled={restarting} onClick={() => void restart()}>
        {restarting ? '다시 시작하는 중…' : '다시 시작해 업데이트'}
      </button>
      <button type="button" className="btn btn-sm btn-secondary" aria-label="업데이트 알림 닫기" onClick={() => setDismissed(true)}>
        나중에
      </button>
    </div>
  );
}

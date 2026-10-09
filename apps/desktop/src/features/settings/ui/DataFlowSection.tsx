import { useEffect, useState } from 'react';
import { ipcErrorMessage } from '../../../ui/lib/ipc-error';
import { SettingsCategory } from './SettingsCategory';

/**
 * Where people's data goes, in plain words. Kept to what the code actually sends: the decision
 * engine and the chosen AI receive request text and, for some steps, content; connected services
 * receive only what a read or an approved send needs; nothing is reported automatically.
 */
export function DataFlowSection() {
  const [keepLocal, setKeepLocal] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.ax.getKeepContentLocal?.().then((value) => { if (active) setKeepLocal(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

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
    <SettingsCategory
      title="데이터가 어디로 가나요"
      description="AX Studio는 이 컴퓨터에서 실행됩니다. 아래 경우에만 데이터가 밖으로 나갑니다."
    >
      <ul className="data-flow-list" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
        <li>
          <strong>판단 엔진(Jev, api.typesafe.ai)</strong>: 보낸 요청 문장과 최근 대화 6개(각 800자까지)를 받아 무엇을 할지 정합니다.
          표를 거르거나 정렬할 때는 해당 열의 값 일부를 받습니다.
          {keepLocal
            ? ' 반복 업무의 메일·문서 내용은 보내지 않습니다(아래 설정).'
            : ' 반복 업무의 AI 판단 단계에서는 메일 제목·보낸 사람·본문과 문서 내용도 받습니다.'}
        </li>
        <li>
          <strong>고른 AI</strong>: 대화 내용과 조회 결과(메일·Slack·DB·API 응답), 보고서의 페이지 이미지와 글자를 받아 답을 씁니다.
          AI를 이 컴퓨터의 Ollama로 고르면 이 내용은 밖으로 나가지 않습니다.
        </li>
        <li>
          <strong>연결한 서비스(Gmail·Slack·API·DB)</strong>: 요청한 조회와 전송만 합니다. 메일 보내기는 항상, 다른 전송은 자동 전송을 켜지 않은
          업무에서 확인을 받은 뒤에 보냅니다. 메일 임시 저장은 확인 없이 Gmail에 저장됩니다.
        </li>
        <li>
          <strong>이 컴퓨터</strong>: 대화·업무·실행 기록과 로그는 이 컴퓨터에만 저장됩니다. 비밀번호와 키는 운영체제 보관함으로 암호화합니다.
          오류 보고나 사용 통계는 보내지 않으며, 진단 정보는 직접 내보낼 때만 파일로 저장됩니다.
        </li>
        <li>
          <strong>업데이트 확인</strong>: 새 버전이 있는지 GitHub에 확인합니다.
        </li>
      </ul>
      {keepLocal !== null && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
          <input type="checkbox" checked={keepLocal} disabled={busy} onChange={(event) => void toggle(event.target.checked)} />
          <span>
            반복 업무의 메일·문서·조회 내용을 이 컴퓨터 밖(판단 엔진·클라우드 AI)으로 보내지 않기
            <br />
            <span className="muted">
              켜면 그런 내용이 필요한 AI 판단 단계는 이 컴퓨터의 AI(Ollama)로만 실행되고, 클라우드 AI를 쓰면 실행하지 않고 멈춥니다.
              채팅에서 직접 요청한 조회·요약은 고른 AI가 받습니다.
            </span>
          </span>
        </label>
      )}
      {message && <p className="muted" role="status">{message}</p>}
    </SettingsCategory>
  );
}

import type { AppState } from '../../../../types/app-state';

/**
 * Chat requests fail closed without the Jev decision service, so a new user would only
 * see refusals. True once state has loaded and Jev is not both configured and enabled.
 */
export function needsJevSetup(state: AppState | null): boolean {
  if (!state) return false;
  return !(state.jevDecisionConfigured && state.jevDecisionEnabled);
}

export function JevSetupNotice({ state, onOpenJevSettings }: { state: AppState | null; onOpenJevSettings: () => void }) {
  if (!needsJevSetup(state)) return null;
  const configuredButOff = Boolean(state?.jevDecisionConfigured);
  return (
    <div className="chat-edit-hint chat-setup-notice" role="status">
      <span>
        {configuredButOff
          ? 'Jev 판단 서비스가 꺼져 있어 자료 조회나 업무 생성 요청을 처리할 수 없습니다.'
          : 'Jev 판단 서비스가 연결되지 않아 자료 조회나 업무 생성 요청을 처리할 수 없습니다.'}
      </span>
      <button type="button" className="btn btn-sm btn-primary" onClick={onOpenJevSettings}>
        {configuredButOff ? 'Jev 켜기' : 'Jev 연결하기'}
      </button>
    </div>
  );
}

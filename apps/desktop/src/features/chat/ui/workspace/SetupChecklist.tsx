import type { AppState } from '../../../../types/app-state';
import type { SettingsScreen } from '../../../../types/navigation';

/**
 * Chat requests fail closed without the Jev decision service, so a new user would only see
 * refusals. True once state has loaded and Jev is not both configured and enabled.
 */
export function needsJevSetup(state: AppState | null): boolean {
  if (!state) return false;
  return !(state.jevDecisionConfigured && state.jevDecisionEnabled);
}

/** Connections that bring data in; a webhook or the test MCP alone does not. */
const DATA_CONNECTORS = new Set(['gmail', 'slack', 'local_folder', 'http', 'rdb', 'openapi']);

export interface SetupStep {
  id: 'ai' | 'jev' | 'data';
  label: string;
  done: boolean;
  /** What the button says while the step is not done. */
  action: string;
  screen: SettingsScreen;
}

/**
 * What a new person must set up before a request can do anything: an AI to write answers, the
 * decision engine to choose actions safely, and at least one source of data. Unknown until the
 * app state has loaded.
 */
export function setupSteps(state: AppState | null): SetupStep[] {
  if (!state) return [];
  const aiReady = Boolean(state.aiProvider?.provider && state.aiProviderInstalled !== false);
  const jevOff = Boolean(state.jevDecisionConfigured) && !state.jevDecisionEnabled;
  const dataReady = state.connections.some((connection) => connection.connected && DATA_CONNECTORS.has(connection.connector));
  return [
    { id: 'ai', label: '답을 쓸 AI 연결', done: aiReady, action: 'AI 연결하기', screen: 'hub' },
    { id: 'jev', label: '판단 엔진(Jev) 연결', done: !needsJevSetup(state), action: jevOff ? '판단 엔진 켜기' : '판단 엔진 연결하기', screen: 'ai-jev' },
    { id: 'data', label: '자료 연결(메일·Slack·폴더·DB·API 중 하나)', done: dataReady, action: '자료 연결하기', screen: 'hub' },
  ];
}

/** Shown above the chat until every step is done; each open step goes straight to its setting. */
export function SetupChecklist({ state, onOpenSettings }: { state: AppState | null; onOpenSettings: (screen: SettingsScreen) => void }) {
  const steps = setupSteps(state);
  const remaining = steps.filter((step) => !step.done);
  if (remaining.length === 0) return null;
  return (
    <div className="chat-edit-hint chat-setup-notice chat-setup-checklist" role="status">
      <div>
        <strong>시작 준비 {steps.length - remaining.length}/{steps.length}</strong>
        <span> · 아래를 마치면 자료 조회와 업무 만들기를 요청할 수 있어요.</span>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {steps.map((step) => (
            <li key={step.id}>
              {step.done ? '✓ ' : ''}{step.label}
              {!step.done && (
                <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: 8 }} onClick={() => onOpenSettings(step.screen)}>
                  {step.action}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

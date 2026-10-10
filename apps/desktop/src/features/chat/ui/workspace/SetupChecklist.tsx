import { useState } from 'react';
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
    { id: 'jev', label: '요청 판단 기능 연결', done: !needsJevSetup(state), action: jevOff ? '요청 판단 켜기' : '요청 판단 연결하기', screen: 'ai-jev' },
    { id: 'data', label: '자료 연결(메일·Slack·폴더·DB·API 중 하나)', done: dataReady, action: '자료 연결하기', screen: 'hub' },
  ];
}

/**
 * Shown above the chat until every step is done. A new person sees the whole list; once a step is
 * done it folds to one line naming the next step, so it no longer pushes the conversation down.
 */
export function SetupChecklist({ state, onOpenSettings }: { state: AppState | null; onOpenSettings: (screen: SettingsScreen) => void }) {
  const steps = setupSteps(state);
  const remaining = steps.filter((step) => !step.done);
  const done = steps.length - remaining.length;
  const [expanded, setExpanded] = useState<boolean | null>(null);
  if (remaining.length === 0) return null;
  const open = expanded ?? done === 0;
  const next = remaining[0]!;
  return (
    <div className={`chat-setup-checklist${open ? ' chat-setup-checklist--open' : ''}`} role="status">
      <div className="chat-setup-checklist-row">
        <strong>시작 준비 {done}/{steps.length}</strong>
        <span className="chat-setup-checklist-next">
          {open ? '아래를 마치면 자료 조회와 업무 만들기를 요청할 수 있어요.' : `다음 · ${next.label}`}
        </span>
        {!open && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenSettings(next.screen)}>
            {next.action}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm btn-ghost chat-setup-checklist-toggle"
          aria-expanded={open}
          onClick={() => setExpanded(!open)}
        >
          {open ? '접기' : '전체 보기'}
        </button>
      </div>
      {open && (
        <ul className="chat-setup-checklist-steps">
          {steps.map((step) => (
            <li key={step.id} className={step.done ? 'done' : undefined}>
              <span className="chat-setup-checklist-mark" aria-hidden="true">{step.done ? '✓' : '○'}</span>
              <span>{step.label}</span>
              {!step.done && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenSettings(step.screen)}>
                  {step.action}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

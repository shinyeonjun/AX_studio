import { SettingSwitch } from '../../SettingRow';
import type { DecisionMode } from './contracts';

interface DecisionModeSectionProps {
  mode: DecisionMode;
  aiProviderLabel?: string;
  shadowCompare: boolean;
  /** Not saved yet: the choice only lives on this screen. */
  preview: boolean;
  onModeChange: (mode: DecisionMode) => void;
  onShadowCompareChange: (enabled: boolean) => void;
}

const MODES: Array<{ mode: DecisionMode; label: string; title: string; description: string }> = [
  {
    mode: 'jev',
    label: 'Jev',
    title: 'Jev가 판단',
    description: '요청을 작은 질문으로 나눠 Jev가 답하고, 앱이 그 답으로 경로와 자료를 고릅니다. 빠르고 비용이 적어요.',
  },
  {
    mode: 'llm',
    label: 'LLM',
    title: 'LLM 에이전트가 판단',
    description: '연결된 AI가 요청 하나를 보고 경로·자료·처리 방식을 한 번에 고릅니다. 앱이 보여준 후보 안에서만 고르고, 실행은 앱이 합니다.',
  },
];

/** Which engine decides a chat request, and whether the other one decides alongside it for comparison. */
export function DecisionModeSection({ mode, aiProviderLabel, shadowCompare, preview, onModeChange, onShadowCompareChange }: DecisionModeSectionProps) {
  const current = MODES.find((entry) => entry.mode === mode)!;
  return (
    <div className="provider-option selected decision-mode" style={{ marginBottom: 16 }}>
      <div className="provider-option-header">
        <div>
          <div className="provider-option-title">
            판단 방식{preview && <span className="connection-badge warning decision-mode-preview">미리보기 · 저장 안 됨</span>}
          </div>
          <div className="provider-option-desc">요청을 보고 무엇을 할지 누가 정할지 고릅니다.</div>
        </div>
        <div className="ai-mode-switch decision-mode-switch" role="group" aria-label="판단 방식">
          {MODES.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              className={`ai-mode-switch-option ${mode === entry.mode ? 'active' : ''}`}
              aria-pressed={mode === entry.mode}
              onClick={() => onModeChange(entry.mode)}
            >
              {entry.label}
            </button>
          ))}
          <span className={`ai-mode-switch-thumb ${mode === 'llm' ? 'right' : ''}`} aria-hidden />
        </div>
      </div>

      <div className="decision-mode-detail">
        <div className="decision-mode-detail-title">{current.title}</div>
        <p className="muted">{current.description}</p>
        {mode === 'llm' && (
          <p className="decision-mode-provider">
            사용할 AI: <strong>{aiProviderLabel ?? '연결된 AI 없음'}</strong>
            {!aiProviderLabel && <span className="muted"> · 위 AI 설정에서 먼저 연결해 주세요</span>}
          </p>
        )}
      </div>

      <div className="decision-mode-shadow">
        <div>
          <div className="setting-row-title">함께 판단해서 비교</div>
          <div className="setting-row-desc">
            실행은 선택한 방식만 하고, 다른 방식도 같은 요청에 판단만 해서 기록합니다. 판단 비용이 두 배로 들어요.
          </div>
        </div>
        <SettingSwitch label="함께 판단해서 비교" checked={shadowCompare} onChange={onShadowCompareChange} />
      </div>
    </div>
  );
}

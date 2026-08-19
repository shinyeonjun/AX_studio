import { loadAgentSkill, renderSkillTemplate } from '../agent-skills/load.js';
import { availableCapabilities, formatCapabilitiesForPrompt } from '../connectors/capability-graph.js';
import type { CompletenessResult } from './requiredness.js';
import type { InterviewDraft } from './workflow-schema.js';

function interpolate(vars: {
  connectedConnectors: string[];
  connected_connectors: string;
  missing_slots: string;
  missing_connections: string;
  workflow_json: string;
  now_iso: string;
  mode_instructions: string;
}): string {
  const skill = loadAgentSkill('interview');
  return renderSkillTemplate(skill.body, {
    capability_catalog: formatCapabilitiesForPrompt(availableCapabilities(vars.connectedConnectors)),
    connected_connectors: vars.connected_connectors,
    missing_slots: vars.missing_slots,
    missing_connections: vars.missing_connections,
    workflow_json: vars.workflow_json,
    now_iso: vars.now_iso,
    mode_instructions: vars.mode_instructions,
  });
}

export function buildInterviewSystemPrompt(input: {
  workflow: InterviewDraft;
  completeness: CompletenessResult;
  connectedConnectors: string[];
  nowIso: string;
}): string {
  return interpolate({
    connectedConnectors: input.connectedConnectors,
    connected_connectors: input.connectedConnectors.join(', ') || '없음',
    missing_slots: input.completeness.missingRequired.join(', ') || '없음',
    missing_connections: input.completeness.missingConnections.join(', ') || '없음',
    workflow_json: JSON.stringify(input.workflow, null, 2),
    now_iso: input.nowIso,
    mode_instructions:
      '지금 모드는 인터뷰입니다. 아래에 나열된 노드만 사용하세요. 없는 도구가 필요하면 연결을 요청하세요. 비어 있는 필수 정보만 한 가지 질문하세요.',
  });
}

export function buildDirectCompileSystemPrompt(nowIso: string, connectedConnectors: string[] = []): string {
  return interpolate({
    connectedConnectors,
    connected_connectors: connectedConnectors.join(', ') || '없음',
    missing_slots: '없음',
    missing_connections: '없음',
    workflow_json: '{}',
    now_iso: nowIso,
    mode_instructions:
      '지금 모드는 한 번에 컴파일입니다. 나열된 노드만 사용해 지시에서 알 수 있는 것을 모두 채우세요.',
  });
}

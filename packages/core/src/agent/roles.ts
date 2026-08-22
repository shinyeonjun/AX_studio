import type { AgentRoleDefinition, AgentRole } from './types.js';

const ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  interview: {
    role: 'interview',
    agentSkillId: 'interview',
    temperature: 0.2,
    policy: { maxTurns: 5, timeoutMs: 90_000 },
    modeInstructions:
      '지금은 workflow authoring agent다. 먼저 필요할 때 tools를 호출해 연결·파일·capability·현재 draft를 확인한다. 그 다음 workflow patch 또는 짧은 reply만 반환한다. patch는 draft에만 적용되며 실행·저장·승인을 하지 않는다. 누락값과 완료 여부는 코드 검수가 소유한다.',
  },
  investigate: {
    role: 'investigate',
    agentSkillId: 'investigate',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 180_000 },
    modeInstructions:
      '지금은 실행 중 판단이다. 더 읽을지, 지금 결론낼지만 정한다. 쓰거나 보내지 않는다.',
  },
  workspace: {
    role: 'workspace',
    agentSkillId: 'workspace',
    temperature: 0.3,
    policy: { maxTurns: 5, timeoutMs: 90_000 },
    modeInstructions:
      '지금은 읽기 전용 workspace 채팅이다. workflow를 설계하거나 Gmail/Slack을 보내지 않는다. 조회가 더 필요하면 kind=tools, 답할 수 있으면 kind=reply만 반환한다.',
  },
};

export function getRoleDefinition(role: AgentRole): AgentRoleDefinition {
  return ROLE_DEFINITIONS[role];
}

export function listAgentRoles(): AgentRole[] {
  return Object.keys(ROLE_DEFINITIONS) as AgentRole[];
}

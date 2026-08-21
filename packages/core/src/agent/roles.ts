import type { AgentRoleDefinition, AgentRole } from './types.js';

const ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  interview: {
    role: 'interview',
    agentSkillId: 'interview',
    temperature: 0.2,
    policy: { maxTurns: 5, timeoutMs: 90_000 },
    modeInstructions:
      '지금은 인터뷰 모드다. plan/patch 구조화 출력만 반환한다. 빈 값은 nextQuestion으로 한 번에 하나만 묻고 patch.set에 반영한다. 일회성 업무는 trigger=manual 고정, 다회성은 trigger도 채팅으로 채운다.',
  },
  investigate: {
    role: 'investigate',
    agentSkillId: 'investigate',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 180_000 },
    modeInstructions:
      '지금은 실행 중 판단이다. 더 읽을지, 지금 결론낼지만 정한다. 쓰거나 보내지 않는다.',
  },
  revise: {
    role: 'revise',
    agentSkillId: 'revise',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 60_000 },
    modeInstructions: '지금은 수정 제안 모드다. 있는 그래프를 고친다. 실행하지 않는다. 요청한 변경만 제안한다.',
  },
};

export function getRoleDefinition(role: AgentRole): AgentRoleDefinition {
  return ROLE_DEFINITIONS[role];
}

export function listAgentRoles(): AgentRole[] {
  return Object.keys(ROLE_DEFINITIONS) as AgentRole[];
}

import type { AgentRoleDefinition, AgentRole } from './types.js';

const ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  interview: {
    role: 'interview',
    agentSkillId: 'interview',
    temperature: 0.2,
    policy: { maxTurns: 5, timeoutMs: 90_000 },
    modeInstructions:
      '지금은 인터뷰 모드다. 사용 가능한 action 목록은 이미 컨텍스트에 있다. 그래프가 없으면 kind=plan, 있으면 kind=patch만 반환한다. nextQuestion은 비운다. 질문은 코드가 한다. 사용자 답은 missing_slots 키로 patch.set에 넣는다. 일회성은 triggerType=manual, 다회성 trigger만 채팅 답으로 채운다.',
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

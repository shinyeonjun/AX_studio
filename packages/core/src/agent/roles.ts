import type { AgentRoleDefinition, AgentRole } from './types.js';

const ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  interview: {
    role: 'interview',
    agentSkillId: 'interview',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 90_000 },
    modeInstructions:
      '지금 모드는 인터뷰입니다. 아래에 나열된 노드만 사용하세요. 없는 도구가 필요하면 연결을 요청하세요. 비어 있는 필수 정보만 한 가지 질문하세요.',
  },
  direct_compile: {
    role: 'direct_compile',
    agentSkillId: 'interview',
    temperature: 0.1,
    policy: { maxTurns: 1, timeoutMs: 90_000 },
    modeInstructions:
      '지금 모드는 한 번에 컴파일입니다. 나열된 노드만 사용해 지시에서 알 수 있는 것을 모두 채우세요.',
  },
  investigate: {
    role: 'investigate',
    agentSkillId: 'investigate',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 60_000 },
  },
  revise: {
    role: 'revise',
    agentSkillId: 'revise',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 60_000 },
    modeInstructions: '지금 모드는 워크플로우 수정 제안입니다. 실행하지 말고 변경 제안만 작성하세요.',
  },
};

export function getRoleDefinition(role: AgentRole): AgentRoleDefinition {
  return ROLE_DEFINITIONS[role];
}

export function listAgentRoles(): AgentRole[] {
  return Object.keys(ROLE_DEFINITIONS) as AgentRole[];
}

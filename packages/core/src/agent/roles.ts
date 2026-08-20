import type { AgentRoleDefinition, AgentRole } from './types.js';

const ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  interview: {
    role: 'interview',
    agentSkillId: 'interview',
    temperature: 0.2,
    policy: { maxTurns: 5, timeoutMs: 90_000 },
    modeInstructions:
      '지금 모드는 인터뷰입니다. 실행(action/write)은 하지 않습니다. 필요하면 design-tools로 connections·sources·capabilities를 조회한 뒤 workflow를 설계하세요. 비어 있는 필수 정보만 한 가지 질문하세요.',
  },
  investigate: {
    role: 'investigate',
    agentSkillId: 'investigate',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 180_000 },
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

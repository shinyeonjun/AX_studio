import type { AgentRoleDefinition, AgentRole } from './types.js';

const ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  investigate: {
    role: 'investigate',
    agentSkillId: 'investigate',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 180_000 },
    modeInstructions:
      '지금은 실행 중 판단이다. 더 읽을지, 지금 결론낼지만 정한다. 쓰거나 보내지 않는다.',
  },
  command: {
    role: 'command',
    agentSkillId: 'command',
    temperature: 0.2,
    policy: { maxTurns: 8, timeoutMs: 120_000 },
    modeInstructions:
      'host가 제공한 AX command만 요청한다. 한 턴에는 command 하나 또는 최종 reply 하나만 반환한다.',
  },
};

export function getRoleDefinition(role: AgentRole): AgentRoleDefinition {
  return ROLE_DEFINITIONS[role];
}

export function listAgentRoles(): AgentRole[] {
  return Object.keys(ROLE_DEFINITIONS) as AgentRole[];
}

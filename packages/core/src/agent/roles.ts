import type { AgentRoleDefinition, AgentRole } from './types.js';

const ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  investigate: {
    role: 'investigate',
    agentSkillId: 'investigate',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 180_000 },
  },
  command: {
    role: 'command',
    agentSkillId: 'command',
    temperature: 0.2,
    policy: { maxTurns: 8, timeoutMs: 120_000 },
  },
};

export function getRoleDefinition(role: AgentRole): AgentRoleDefinition {
  return ROLE_DEFINITIONS[role];
}

export function listAgentRoles(): AgentRole[] {
  return Object.keys(ROLE_DEFINITIONS) as AgentRole[];
}

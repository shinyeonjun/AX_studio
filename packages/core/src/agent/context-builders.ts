import { formatCapabilitiesForPrompt, relevantCapabilitiesForInvestigate } from '../catalog/capability-graph.js';
import type {
  AgentContext,
  AgentRole,
  CommandAgentContext,
  InvestigateAgentContext,
} from './types.js';
import { getRoleDefinition } from './roles.js';
import { loadAgentSkill, renderSkillTemplate } from './skill-load.js';

export function buildRoleSystemPrompt(role: AgentRole, context: AgentContext): string {
  const definition = getRoleDefinition(role);
  const skill = loadAgentSkill(definition.agentSkillId);

  if (role === 'investigate') {
    const ctx = context as InvestigateAgentContext;
    const untrusted = ctx.untrustedData?.trim();
    const readCaps = formatCapabilitiesForPrompt(
      relevantCapabilitiesForInvestigate(ctx.connectedConnectors),
      ctx.connectedConnectors,
    );
    return renderSkillTemplate(skill.body, {
      skill_goal: ctx.skillGoal,
      task_goal: ctx.taskGoal,
      task_memo: ctx.taskMemo?.trim() || '(없음)',
      read_capabilities: readCaps,
      evidence_json: JSON.stringify(ctx.evidence),
      untrusted_block: untrusted ? `\n\n[UNTRUSTED DATA]\n${untrusted}` : '',
    });
  }

  if (role === 'command') {
    const ctx = context as CommandAgentContext;
    return renderSkillTemplate(skill.body, {
      connected_connectors: ctx.connectedConnectors.join(', ') || '없음',
      connected_resources: ctx.connectedResources,
    });
  }

  throw new Error(`Unsupported agent role: ${role satisfies never}`);
}

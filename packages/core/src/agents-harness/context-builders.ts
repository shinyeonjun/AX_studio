import { availableCapabilities, formatCapabilitiesForPrompt } from '../connectors/capability-graph.js';
import type {
  AgentContext,
  AgentRole,
  DirectCompileAgentContext,
  InterviewAgentContext,
  InvestigateAgentContext,
  ReviseAgentContext,
} from './types.js';
import { getRoleDefinition } from './roles.js';
import { loadAgentSkill, renderSkillTemplate } from './skill-load.js';

export function buildRoleSystemPrompt(role: AgentRole, context: AgentContext): string {
  const definition = getRoleDefinition(role);
  const skill = loadAgentSkill(definition.skillId);

  if (role === 'interview') {
    const ctx = context as InterviewAgentContext;
    return renderSkillTemplate(skill.body, {
      capability_catalog: formatCapabilitiesForPrompt(availableCapabilities(ctx.connectedConnectors)),
      connected_connectors: ctx.connectedConnectors.join(', ') || '없음',
      missing_slots: ctx.completeness.missingRequired.join(', ') || '없음',
      missing_connections: ctx.completeness.missingConnections.join(', ') || '없음',
      workflow_json: JSON.stringify(ctx.workflow, null, 2),
      now_iso: ctx.nowIso,
      mode_instructions: definition.modeInstructions ?? '',
    });
  }

  if (role === 'direct_compile') {
    const ctx = context as DirectCompileAgentContext;
    const connected = ctx.connectedConnectors ?? [];
    return renderSkillTemplate(skill.body, {
      capability_catalog: formatCapabilitiesForPrompt(availableCapabilities(connected)),
      connected_connectors: connected.join(', ') || '없음',
      missing_slots: '없음',
      missing_connections: '없음',
      workflow_json: '{}',
      now_iso: ctx.nowIso,
      mode_instructions: definition.modeInstructions ?? '',
    });
  }

  if (role === 'investigate') {
    const ctx = context as InvestigateAgentContext;
    const untrusted = ctx.untrustedData?.trim();
    return renderSkillTemplate(skill.body, {
      skill_goal: ctx.skillGoal,
      task_goal: ctx.taskGoal,
      evidence_json: JSON.stringify(ctx.evidence),
      untrusted_block: untrusted ? `\n\n[UNTRUSTED DATA]\n${untrusted}` : '',
    });
  }

  if (role === 'revise') {
    const ctx = context as ReviseAgentContext;
    return renderSkillTemplate(skill.body, {
      skill_json: ctx.skillJson,
      instruction: ctx.instruction,
      mode_instructions: definition.modeInstructions ?? '',
    });
  }

  throw new Error(`Unsupported agent role: ${role satisfies never}`);
}

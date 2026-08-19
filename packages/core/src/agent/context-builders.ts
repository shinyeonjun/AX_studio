import {
  formatCapabilitiesForPrompt,
  relevantCapabilitiesForInterview,
  relevantCapabilitiesForInvestigate,
} from '../catalog/capability-graph.js';
import type {
  AgentContext,
  AgentRole,
  InterviewAgentContext,
  InvestigateAgentContext,
  ReviseAgentContext,
} from './types.js';
import { getRoleDefinition } from './roles.js';
import { loadAgentSkill, renderSkillTemplate } from './skill-load.js';
import { formatWorkflowState } from './prompt-context.js';
import { formatDesignToolsForPrompt } from '../design-tools/format.js';

export function buildRoleSystemPrompt(role: AgentRole, context: AgentContext): string {
  const definition = getRoleDefinition(role);
  const skill = loadAgentSkill(definition.agentSkillId);

  if (role === 'interview') {
    const ctx = context as InterviewAgentContext;
    return renderSkillTemplate(skill.body, {
      capability_catalog: formatCapabilitiesForPrompt(
        relevantCapabilitiesForInterview(ctx.workflow, ctx.connectedConnectors),
      ),
      connected_connectors: ctx.connectedConnectors.join(', ') || '없음',
      design_tools: formatDesignToolsForPrompt(),
      missing_slots: ctx.completeness.missingRequired.join(', ') || '없음',
      missing_connections: ctx.completeness.missingConnections.join(', ') || '없음',
      workflow_state: formatWorkflowState(ctx.workflow),
      now_iso: ctx.nowIso,
      mode_instructions: definition.modeInstructions ?? '',
    });
  }

  if (role === 'investigate') {
    const ctx = context as InvestigateAgentContext;
    const untrusted = ctx.untrustedData?.trim();
    const readCaps = formatCapabilitiesForPrompt(
      relevantCapabilitiesForInvestigate(ctx.connectedConnectors),
    );
    return renderSkillTemplate(skill.body, {
      skill_goal: ctx.skillGoal,
      task_goal: ctx.taskGoal,
      read_capabilities: readCaps,
      evidence_json: JSON.stringify(ctx.evidence),
      untrusted_block: untrusted ? `\n\n[UNTRUSTED DATA]\n${untrusted}` : '',
    });
  }

  if (role === 'revise') {
    const ctx = context as ReviseAgentContext;
    return renderSkillTemplate(skill.body, {
      skill_json: ctx.workflowJson,
      instruction: ctx.instruction,
      mode_instructions: definition.modeInstructions ?? '',
    });
  }

  throw new Error(`Unsupported agent role: ${role satisfies never}`);
}

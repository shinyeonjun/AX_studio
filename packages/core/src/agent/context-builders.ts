import {
  availableCapabilities,
  formatCapabilitiesForPrompt,
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
import { loadAgentSkill, renderConnectorSkills, renderSkillTemplate } from './skill-load.js';
import { connectorSkillsForRole } from './skill-routing.js';
import { formatWorkflowState } from './prompt-context.js';
import { formatDesignToolsForPrompt } from '../design-tools/format.js';
import { formatPartialPlanForPrompt } from '../interview/plan/schema.js';
import { formatSlotValuesForPrompt } from '../interview/slots/prompts.js';
import { formatMissingSlotsForPrompt } from '../interview/slots/requiredness.js';

export function buildRoleSystemPrompt(role: AgentRole, context: AgentContext): string {
  const definition = getRoleDefinition(role);
  const skill = loadAgentSkill(definition.agentSkillId);
  const connector_skills = renderConnectorSkills(connectorSkillsForRole(role, context));

  if (role === 'interview') {
    const ctx = context as InterviewAgentContext;
    return renderSkillTemplate(skill.body, {
      capability_catalog: formatCapabilitiesForPrompt(
        availableCapabilities(ctx.connectedConnectors),
      ),
      connected_connectors: ctx.connectedConnectors.join(', ') || '없음',
      design_tools: formatDesignToolsForPrompt(),
      missing_slots: formatMissingSlotsForPrompt(ctx.completeness),
      missing_connections: ctx.completeness.missingConnections.join(', ') || '없음',
      connected_resources: ctx.connectedResources,
      session_hints: ctx.sessionHints,
      workflow_state: formatWorkflowState(ctx.workflow),
      partial_plan: formatPartialPlanForPrompt(ctx.partialPlan),
      slot_values: formatSlotValuesForPrompt(ctx.slotValues),
      now_iso: ctx.nowIso,
      mode_instructions: definition.modeInstructions ?? '',
      connector_skills,
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
      task_memo: ctx.taskMemo?.trim() || '(없음)',
      read_capabilities: readCaps,
      evidence_json: JSON.stringify(ctx.evidence),
      untrusted_block: untrusted ? `\n\n[UNTRUSTED DATA]\n${untrusted}` : '',
      mode_instructions: definition.modeInstructions ?? '',
      connector_skills,
    });
  }

  if (role === 'revise') {
    const ctx = context as ReviseAgentContext;
    return renderSkillTemplate(skill.body, {
      skill_json: ctx.workflowJson,
      instruction: ctx.instruction,
      mode_instructions: definition.modeInstructions ?? '',
      connector_skills,
    });
  }

  throw new Error(`Unsupported agent role: ${role satisfies never}`);
}

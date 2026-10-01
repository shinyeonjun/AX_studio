import type { AgentContext, AgentRole, InvestigateAgentContext } from '../types.js';
import { getRoleDefinition } from '../types.js';
import { loadAgentSkill, renderSkillTemplate } from '../skill-load.js';

export function buildInvestigatePrompt(role: AgentRole, context: AgentContext): string {
  if (role !== 'investigate') {
    throw new Error(`Unsupported agent role for investigate prompt: ${role}`);
  }

  const definition = getRoleDefinition(role);
  const skill = loadAgentSkill(definition.agentSkillId);
  const ctx = context as InvestigateAgentContext;
  const untrusted = ctx.untrustedData?.trim();
  return renderSkillTemplate(skill.body, {
    skill_goal: ctx.skillGoal,
    task_goal: ctx.taskGoal,
    task_memo: ctx.taskMemo?.trim() || '(없음)',
    evidence_json: JSON.stringify(ctx.evidence),
    untrusted_block: untrusted ? `\n\n[UNTRUSTED DATA]\n${untrusted}` : '',
  });
}

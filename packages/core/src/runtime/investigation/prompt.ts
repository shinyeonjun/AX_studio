import type { ConnectorContext } from '../../modules/types.js';
import type { WorkflowIR, Step } from '../../workflow/schema.js';
import { buildInvestigationUser } from './input.js';

export function investigationUserPrompt(
  step: Step & { type: 'ai_decision' },
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  ir: WorkflowIR,
  extra?: string,
  includeSensitiveData = true,
): string {
  const base = buildInvestigationUser(step, ctx, stepResults, { includeSensitiveData, ir });
  if (!step.investigation) {
    return `${base}\n\n추가 조회 없이 지금 결론만 내세요. needMore는 false로 두세요.`;
  }
  return extra ? `${base}\n\n${extra}` : base;
}

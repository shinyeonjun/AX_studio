import type { ConnectorContext } from '../../connectors/types.js';
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
    return `${base}\n\n추가 자료 조회는 실행되지 않았습니다. 현재 제공된 근거만으로 결론을 작성하고, 근거가 부족하면 부족하다고 명시하세요.`;
  }
  return [
    base,
    'Jev가 선택한 읽기 작업은 이미 호스트에서 실행되었습니다. 도구나 다음 조회를 요청하지 말고 현재 근거만으로 결론과 선언된 출력 필드를 작성하세요.',
    extra,
  ].filter(Boolean).join('\n\n');
}

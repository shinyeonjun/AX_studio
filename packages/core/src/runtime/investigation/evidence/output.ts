import type { ConnectorContext } from '../../../modules/types.js';
import type { Step } from '../../../workflow/schema.js';
import {
  mapInvestigationOutput,
  previewDecisionOutput,
  requiredOutputFields,
} from '../output.js';

function validateDecisionEvidence(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
  evidenceAvailable: boolean,
  evidenceRequired: boolean,
): void {
  const properties = step.outputSchema?.properties;
  const declaresRiskLevel = Boolean(
    properties &&
      typeof properties === 'object' &&
      !Array.isArray(properties) &&
      'riskLevel' in properties,
  ) || 'riskLevel' in output;
  if (!declaresRiskLevel) return;

  if (evidenceRequired && !evidenceAvailable) {
    throw Object.assign(new Error(`AI 판단 단계 ${step.id}에 분석 근거가 없습니다.`), {
      code: 'ai_evidence_missing',
    });
  }

  const category = output.category;
  const confidence = output.confidence;
  if (category === 'undetermined' || (typeof confidence === 'number' && confidence <= 0)) {
    throw Object.assign(new Error(`AI 판단 단계 ${step.id}가 근거 부족 결과를 반환했습니다.`), {
      code: 'ai_output_undetermined',
    });
  }
}

export function persistDecisionOutput(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  evidenceAvailable: boolean,
  evidenceRequired: boolean,
): void {
  validateDecisionEvidence(step, output, evidenceAvailable, evidenceRequired);
  stepResults[step.id] = mapInvestigationOutput(step, output);
  const declaredOutputFields =
    step.outputSchema?.properties && typeof step.outputSchema.properties === 'object'
      ? Object.keys(step.outputSchema.properties)
      : [];
  const missingOutputFields = requiredOutputFields(step).filter((field) => output[field] == null);
  ctx.log({
    at: new Date().toISOString(),
    level: 'info',
    code: 'ai_decision_completed',
    message: `AI 분석 완료: ${step.id}`,
    data: {
      stepId: step.id,
      evidenceAvailable,
      outputFields: Object.keys(output),
      declaredOutputFields,
      missingOutputFields,
      outputPreview: previewDecisionOutput(output),
      riskLevel: typeof output.riskLevel === 'string' ? output.riskLevel : undefined,
      confidence: typeof output.confidence === 'number' ? output.confidence : undefined,
    },
  });
}

export function hasRequiredOutputFields(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
): boolean {
  return requiredOutputFields(step).every((field) => output[field] != null);
}

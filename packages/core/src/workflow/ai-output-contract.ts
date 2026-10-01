import { classifyDecisionOutput } from '../contracts/decision.js';
import { resolveCapability } from '../catalog/capability-graph.js';
import type { Step } from './schema.js';

type AiStep = Extract<Step, { type: 'ai_decision' }>;
type ActionStep = Extract<Step, { type: 'action' }>;

export const PROSE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: { conclusion: { type: 'string', purpose: 'prose' } },
  required: ['conclusion'],
};

export function decisionOutputProperties(step: AiStep): Record<string, unknown> {
  // Legacy steps without a schema retain only the presentation conclusion.
  // A supplied schema must declare every output; it has no implicit extras.
  if (step.outputSchema === undefined) return PROSE_OUTPUT_SCHEMA.properties;
  const properties = step.outputSchema.properties;
  return properties && typeof properties === 'object' && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : {};
}

export function decisionOutputDefinition(step: AiStep, field: string): unknown {
  const properties = decisionOutputProperties(step);
  return Object.hasOwn(properties, field) ? properties[field] : undefined;
}

export function decisionRequiredFields(step: AiStep): string[] {
  if (step.outputSchema === undefined) return ['conclusion'];
  return Array.isArray(step.outputSchema.required)
    ? step.outputSchema.required.filter((value): value is string => typeof value === 'string')
    : [];
}

export function isProseOnlyDecision(step: AiStep): boolean {
  const definitions = Object.values(decisionOutputProperties(step));
  return !step.investigation && definitions.length > 0
    && definitions.every((definition) => classifyDecisionOutput(definition).kind === 'model');
}

/** Purpose is a host-owned catalog contract, independent of UI input type. */
export function isProseActionInput(step: ActionStep, port: string): boolean {
  return resolveCapability(step.connector, step.action)?.params
    .some((parameter) => parameter.name === port && parameter.purpose === 'prose') === true;
}

export function decisionOutputContractErrors(step: AiStep): string[] {
  const properties = decisionOutputProperties(step);
  const errors: string[] = [];
  if (Object.keys(properties).length === 0) errors.push('outputSchema.properties가 비어 있거나 올바르지 않습니다.');
  for (const [field, definition] of Object.entries(properties)) {
    if (classifyDecisionOutput(definition).kind === 'unsupported') {
      errors.push(`${field}: 문안 출력은 { type: "string", purpose: "prose" }, 판단 출력은 boolean 또는 255개 이하의 string/number enum으로 선언하세요.`);
    }
  }
  for (const field of decisionRequiredFields(step)) {
    if (!Object.hasOwn(properties, field)) errors.push(`required의 ${field}가 properties에 선언되지 않았습니다.`);
  }
  return errors;
}

export function assertDecisionOutputContract(step: AiStep): void {
  const errors = decisionOutputContractErrors(step);
  if (errors.length === 0) return;
  throw Object.assign(new Error(`${step.id} 출력 계약을 수정한 뒤 다시 실행하세요. ${errors.join(' ')}`), {
    code: 'ai_output_contract_invalid', data: { stepId: step.id },
  });
}

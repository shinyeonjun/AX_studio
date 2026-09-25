import type { ConnectorContext } from '../../connectors/types.js';
import type { DecisionAnswer, DecisionEngine, DecisionInstruction, DecisionQuestion } from '../../contracts/decision.js';
import { classifyDecisionOutput, MAX_DECISION_CHOICE_CRITERIA } from '../../contracts/decision.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../intelligence/decision/context.js';
import type { Step } from '../../workflow/schema.js';

export interface DecisionOutputPlan {
  readonly questions: Record<string, DecisionQuestion>;
  readonly bindings: Map<string, DecisionOutputBinding>;
  readonly values: Record<string, unknown>;
  readonly jevUnavailableFields: string[];
  /** undefined means the schema is unstructured and stays with the LLM. */
  readonly modelFields?: string[];
}

interface DecisionOutputBinding {
  field: string;
  options: Map<string, string | number | boolean>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function planDecisionOutputs(
  step: Step & { type: 'ai_decision' },
  decisionEngine?: DecisionEngine,
): DecisionOutputPlan {
  const properties = record(step.outputSchema?.properties);
  if (!properties) return { questions: {}, bindings: new Map(), values: {}, jevUnavailableFields: [] };

  const questions: Record<string, DecisionQuestion> = {};
  const bindings = new Map<string, DecisionOutputBinding>();
  const values: Record<string, unknown> = {};
  const jevUnavailableFields: string[] = [];
  const modelFields: string[] = [];
  let questionIndex = 0;

  for (const [field, definition] of Object.entries(properties)) {
    const schema = record(definition);
    const route = classifyDecisionOutput(schema);
    if (route.kind === 'boolean') {
      if (!decisionEngine) {
        jevUnavailableFields.push(field);
        continue;
      }
      const id = `output_${questionIndex++}`;
      const options = new Map<string, string | number | boolean>([['true', true], ['false', false]]);
      questions[id] = {
        type: 'choice',
        instructions: {
          task: boundDecisionString(step.goal),
          field: boundDecisionString(field, 128),
          description: typeof schema?.description === 'string' ? boundDecisionString(schema.description, 512) : undefined,
          policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
        },
        criteria: {
          true: 'The available evidence supports true.',
          false: 'The available evidence supports false.',
          unclear: 'The evidence is insufficient or conflicting; do not guess.',
        },
      };
      bindings.set(id, { field, options });
      continue;
    }

    if (route.kind === 'model') {
      modelFields.push(field);
      continue;
    }
    if (route.kind === 'unsupported') {
      jevUnavailableFields.push(field);
      continue;
    }
    if (route.kind === 'constant') {
      values[field] = route.value;
      continue;
    }
    if (!decisionEngine) {
      jevUnavailableFields.push(field);
      continue;
    }

    const id = `output_${questionIndex++}`;
    // Jev sees string criteria; the host maps its selected key back to the typed schema value.
    const optionMap = new Map(route.options.map((option, index) => [`option_${index}`, option]));
    const criteria: Record<string, DecisionInstruction> = Object.fromEntries(
      [...optionMap].map(([key, value]) => [key, { value: boundDecisionString(String(value), 256) }]),
    );
    // Reserve a protocol slot for abstention when the declared enum leaves room.
    if (optionMap.size < MAX_DECISION_CHOICE_CRITERIA) {
      criteria.unclear = 'The evidence is insufficient or conflicting; do not guess.';
    }
    questions[id] = {
      type: 'choice',
      instructions: {
        task: boundDecisionString(step.goal),
        field: boundDecisionString(field, 128),
        description: typeof schema?.description === 'string' ? boundDecisionString(schema.description, 512) : undefined,
        policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
        rule: 'Choose only a listed schema value. If none is supported by the evidence, omit the answer rather than guess.',
      },
      criteria,
    };
    bindings.set(id, { field, options: optionMap });
  }

  return { questions, bindings, values, jevUnavailableFields, modelFields };
}

function uncertainDecision(stepId: string, field: string): never {
  throw Object.assign(
    new Error(`Jev가 '${field}' 필드에 유효하고 명확한 선택을 반환하지 않았습니다. 근거를 확인한 뒤 다시 실행하세요.`),
    { code: 'ai_decision_uncertain', data: { stepId, field } },
  );
}

function valueFromJevAnswer(
  stepId: string,
  binding: DecisionOutputBinding,
  answer: DecisionAnswer | undefined,
): unknown {
  const option = answer?.type === 'choice' ? binding.options.get(answer.choice) : undefined;
  if (option === undefined) return uncertainDecision(stepId, binding.field);
  return option;
}

export async function evaluateDecisionOutputs(input: {
  step: Step & { type: 'ai_decision' };
  ctx: ConnectorContext;
  plan: DecisionOutputPlan;
  decisionEngine?: DecisionEngine;
  decisionInput: string;
  evidence: Array<{ source: string; detail: string }>;
}): Promise<Record<string, unknown>> {
  const output = { ...input.plan.values };
  if (!input.decisionEngine || Object.keys(input.plan.questions).length === 0) return output;

  let evaluation;
  try {
    evaluation = await input.decisionEngine.evaluate({
      state: {
        workflowInput: boundDecisionString(input.decisionInput, 24_000),
        readEvidence: input.evidence.map((item) => ({
          source: boundDecisionString(item.source, 160),
          detail: boundDecisionString(item.detail, 500),
        })),
        policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
        purpose: 'workflow_ai_decision_output',
      },
      questions: input.plan.questions,
      signal: input.ctx.abortSignal,
    });
  } catch (error) {
    if (input.ctx.abortSignal?.aborted) throw error;
    input.ctx.log({
      at: new Date().toISOString(), level: 'warn', code: 'ai_decision_jev_failed',
      message: 'Jev가 선언된 판단 출력을 만들지 못했습니다.',
      data: { stepId: input.step.id, fieldCount: input.plan.bindings.size, errorCode: error instanceof Error ? error.name : 'unknown' },
    });
    throw Object.assign(new Error('Jev 판단 호출에 실패해 workflow 실행을 중단했습니다.'), { code: 'jev_decision_failed' });
  }

  input.ctx.abortSignal?.throwIfAborted();
  for (const [questionId, binding] of input.plan.bindings) {
    try {
      output[binding.field] = valueFromJevAnswer(input.step.id, binding, evaluation.answers[questionId]);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ai_decision_uncertain') {
        input.ctx.log({
          at: new Date().toISOString(), level: 'warn', code: 'ai_decision_output_unclear',
          message: 'Jev가 선언된 출력 필드에 명확한 선택을 반환하지 않아 workflow 실행을 중단했습니다.',
          data: {
            stepId: input.step.id,
            field: binding.field,
            providerRequestCount: evaluation.providerRequestCount ?? 1,
            ...(evaluation.model ? { model: evaluation.model } : {}),
          },
        });
      }
      throw error;
    }
  }
  input.ctx.log({
    at: new Date().toISOString(), level: 'info', code: 'ai_decision_jev_completed',
    message: `Jev가 선언된 판단 필드 ${input.plan.bindings.size}개를 분류했습니다.`,
    data: {
      stepId: input.step.id,
      fieldCount: input.plan.bindings.size,
      providerRequestCount: evaluation.providerRequestCount ?? 1,
      model: evaluation.model,
      inputTokens: evaluation.usage?.inputTokens,
      outputTokens: evaluation.usage?.outputTokens,
    },
  });
  return output;
}

import type { Connector, ConnectorContext, ConnectorFailureKind } from '../../connectors/types.js';
import { isRecoverableConnectorFailure } from '../../connectors/failure-kind.js';
import type { DecisionEngine, DecisionQuestion } from '../../contracts/decision.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../intelligence/decision/context.js';
import { buildJevReadOperationIndex } from '../../intelligence/decision/read-operation-catalog.js';
import { untrustedEvidencePreview } from './input.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import { CapabilityReadFailure, performCapabilityRead } from '../capability-read.js';
import { evaluateDecisionOutputs, planDecisionOutputs } from './decision-outputs.js';
import {
  decisionEngineCanReceiveEvidence,
  hasDecisionEvidenceFromBindings,
  hasRequiredOutputFields,
  persistDecisionOutput,
} from './evidence.js';

const READ_DECISION_PREFIX = 'read_';

export type DecisionModelRun = (options: {
  requireDeclaredFields: boolean;
  final: boolean;
  outputFields?: string[];
  decisionValues?: Record<string, unknown>;
}) => Promise<DecisionModelOutput>;

export type DecisionModelOutput = Record<string, unknown> & {
  needMore?: boolean;
  conclusion?: string;
};

export interface DecisionLoopContext {
  readonly step: Step & { type: 'ai_decision' };
  readonly ir: WorkflowIR;
  readonly ctx: ConnectorContext;
  readonly stepResults: Record<string, unknown>;
  readonly connectors: Record<string, Connector>;
  readonly allowReads: boolean;
  readonly maxReads?: number;
  readonly cloudAllowed: boolean;
  readonly evidence: Array<{ source: string; detail: string }>;
  readonly documentRequired: boolean;
  readonly decisionEngine?: DecisionEngine;
  readonly outputDecisionEngine?: DecisionEngine;
  readonly decisionInput: string;
  readonly runModel?: DecisionModelRun;
}

export async function runAiDecisionLoop({
  step,
  ir,
  ctx,
  stepResults,
  connectors,
  allowReads,
  maxReads,
  cloudAllowed,
  evidence,
  documentRequired,
  decisionEngine,
  outputDecisionEngine,
  decisionInput,
  runModel,
}: DecisionLoopContext): Promise<void> {
  let reads = 0;
  const usedKeys = new Set<string>();
  const readFailures: Array<{ source: string; operation: string; errorCode: string; failureKind: ConnectorFailureKind }> = [];
  const task = [step.goal, step.memo].filter((value): value is string => Boolean(value?.trim())).join('\n');
  const outputPlan = planDecisionOutputs(step, outputDecisionEngine);
  if (outputPlan.jevUnavailableFields.length > 0) {
    const fields = outputPlan.jevUnavailableFields.slice(0, 32).map(field => field.slice(0, 128));
    ctx.log({
      at: new Date().toISOString(), level: 'warn', code: 'ai_decision_jev_unavailable',
      message: 'Jev 구조화 판단이 필요한 출력을 처리할 수 없어 LLM으로 대체하지 않고 실행을 중단했습니다.',
      data: { stepId: step.id, fieldCount: outputPlan.jevUnavailableFields.length, fields },
    });
    throw Object.assign(
      new Error('boolean/enum 출력을 Jev로 처리할 수 없어 LLM 판단으로 대체하지 않았습니다.'),
      { code: 'jev_unavailable', data: { stepId: step.id, fields } },
    );
  }
  if (!runModel && (outputPlan.modelFields === undefined || outputPlan.modelFields.length > 0)) {
    throw Object.assign(new Error('이 AI 판단의 문장 출력에 사용할 LLM이 없습니다.'), { code: 'agent_unavailable' });
  }
  const readIndex = allowReads ? buildJevReadOperationIndex(ctx.connections ?? []) : undefined;

  while (allowReads && (maxReads === undefined || reads < maxReads) && readIndex) {
    ctx.abortSignal?.throwIfAborted();
    const candidates = readIndex.select(task).hints.filter((hint) =>
      !usedKeys.has(hint.key) && (hint.missingParameterPaths?.length ?? 0) === 0,
    );
    if (candidates.length === 0) break;
    if (!decisionEngine) {
      ctx.log({
        at: new Date().toISOString(), level: 'warn', code: 'ai_investigation_jev_unavailable',
        message: 'Jev가 설정되지 않아 추가 자료 조회를 건너뛰었습니다.',
        data: { stepId: step.id, candidateCount: candidates.length },
      });
      break;
    }

    const questions: Record<string, DecisionQuestion> = Object.fromEntries(candidates.map((hint) => [
      `${READ_DECISION_PREFIX}${hint.key}`,
      {
        type: 'choice',
        instructions: {
          question: 'Should this read operation be called now to gather evidence for the workflow task?',
          task: boundDecisionString(task, 2_048),
          operation: {
            label: boundDecisionString(hint.label, 160),
            description: boundDecisionString(hint.description, 320),
            connector: boundDecisionString(hint.connector, 80),
          },
          policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
        },
        criteria: {
          read: 'Call this operation now; it is directly relevant and likely to add useful evidence.',
          skip: 'Do not call it; it is irrelevant, redundant, speculative, or unnecessary.',
          unclear: 'There is not enough context to choose safely; do not call it yet.',
        },
      },
    ]));
    const visibleEvidence = evidence.filter((item) =>
      decisionEngineCanReceiveEvidence(decisionEngine, ir, cloudAllowed, item.source),
    );
    const visibleReadFailures = readFailures.filter((item) =>
      decisionEngineCanReceiveEvidence(decisionEngine, ir, cloudAllowed, item.source),
    );
    let evaluation;
    try {
      evaluation = await decisionEngine.evaluate({
        state: {
          task: boundDecisionString(task, 2_048),
          outputFields: Object.keys(step.outputSchema?.properties ?? {}).slice(0, 64),
          previouslyRead: [...usedKeys],
          readFailures: visibleReadFailures.map(({ source, operation, errorCode, failureKind }) => ({
            source: boundDecisionString(source, 160),
            operation: boundDecisionString(operation, 160),
            errorCode,
            failureKind,
          })),
          readEvidence: visibleEvidence.map((item) => ({
            source: boundDecisionString(item.source, 160),
            detail: boundDecisionString(item.detail, 500),
          })),
          policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
        },
        questions,
        signal: ctx.abortSignal,
      });
    } catch (error) {
      if (ctx.abortSignal?.aborted) throw error;
      ctx.log({
        at: new Date().toISOString(), level: 'warn', code: 'ai_investigation_jev_failed',
        message: 'Jev 조회 선택에 실패해 추가 자료 조회를 중단했습니다.',
        data: { stepId: step.id, errorCode: error instanceof Error ? error.name : 'unknown' },
      });
      break;
    }
    ctx.abortSignal?.throwIfAborted();
    const selected: Array<{ hint: typeof candidates[number]; priority: number }> = [];
    let invalidAnswers = 0;
    let uncertainAnswers = 0;
    for (const hint of candidates) {
      const answer = evaluation.answers[`${READ_DECISION_PREFIX}${hint.key}`];
      if (answer?.type !== 'choice' || !['read', 'skip', 'unclear'].includes(answer.choice)) {
        invalidAnswers += 1;
        continue;
      }
      if (answer.choice === 'read') {
        // Choice controls inclusion; confidence only prioritizes reads under an explicit workflow budget.
        const confidence = answer.confidence;
        selected.push({ hint, priority: typeof confidence === 'number' && Number.isFinite(confidence)
          && confidence >= 0 && confidence <= 1 ? confidence : 0 });
      } else if (answer.choice === 'unclear') {
        uncertainAnswers += 1;
      }
    }
    if (invalidAnswers > 0) {
      ctx.log({
        at: new Date().toISOString(), level: 'warn', code: 'ai_investigation_jev_invalid_answer',
        message: 'Jev가 일부 조회 판단을 반환하지 않아 해당 조회를 건너뛰었습니다.',
        data: { stepId: step.id, candidateCount: candidates.length, invalidAnswers },
      });
    }
    if (uncertainAnswers > 0) {
      ctx.log({
        at: new Date().toISOString(), level: 'info', code: 'ai_investigation_jev_uncertain',
        message: 'Jev의 신뢰도가 부족한 조회 후보를 건너뛰었습니다.',
        data: { stepId: step.id, candidateCount: candidates.length, uncertainAnswers },
      });
    }
    if (selected.length === 0) {
      ctx.log({
        at: new Date().toISOString(), level: 'info', code: 'ai_investigation_read_stopped',
        message: '이번 배치에서 실행할 읽기 작업을 선택하지 않았습니다.',
        data: {
          stepId: step.id,
          candidateCount: candidates.length,
          readCount: reads,
          invalidAnswers,
          uncertainAnswers,
          model: evaluation.model,
          providerRequestCount: evaluation.providerRequestCount,
          inputTokens: evaluation.usage?.inputTokens,
          outputTokens: evaluation.usage?.outputTokens,
        },
      });
      break;
    }

    const remainingBudget = maxReads === undefined ? selected.length : maxReads - reads;
    const batch = selected
      .sort((left, right) => right.priority - left.priority)
      .slice(0, remainingBudget);
    for (const { hint } of batch) usedKeys.add(hint.key);
    const firstReadIndex = reads + 1;
    reads += batch.length;
    ctx.log({
      at: new Date().toISOString(), level: 'info', code: 'ai_investigation_read_batch_selected',
      message: 'Jev가 필요한 읽기 작업을 배치로 선택했습니다.',
      data: {
        stepId: step.id,
        candidateCount: candidates.length,
        selectedCount: selected.length,
        readCount: batch.length,
        skippedByReadBudget: selected.length - batch.length,
        model: evaluation.model,
        providerRequestCount: evaluation.providerRequestCount,
        inputTokens: evaluation.usage?.inputTokens,
        outputTokens: evaluation.usage?.outputTokens,
      },
    });

    // Jev evaluates these questions independently; join every read before exposing evidence.
    // A private variable map avoids racing on connector scratch values such as queryResult.
    const outcomes = await Promise.allSettled(batch.map(async ({ hint }) => {
      return performCapabilityRead(
        hint.capabilityId,
        { ...ctx, variables: { ...ctx.variables } },
        connectors,
        hint.params,
      );
    }));
    ctx.abortSignal?.throwIfAborted();
    const unrecoverable = outcomes.find((outcome) => outcome.status === 'rejected'
      && (!(outcome.reason instanceof CapabilityReadFailure)
        || !isRecoverableConnectorFailure(outcome.reason.failureKind)));
    if (unrecoverable?.status === 'rejected') throw unrecoverable.reason;

    for (const [index, outcome] of outcomes.entries()) {
      const { hint } = batch[index]!;
      if (outcome.status === 'rejected') {
        const failure = outcome.reason as CapabilityReadFailure;
        readFailures.push({ source: hint.capabilityId, operation: hint.label,
          errorCode: failure.errorCode, failureKind: failure.failureKind });
        ctx.log({
          at: new Date().toISOString(), level: 'warn', code: 'ai_investigation_read_failed',
          message: 'Jev가 선택한 조회가 실패했습니다. 남은 후보를 다시 판단할 수 있습니다.',
          data: { stepId: step.id, capabilityId: hint.capabilityId,
            readIndex: firstReadIndex + index, failureKind: failure.failureKind, errorCode: failure.errorCode },
        });
        continue;
      }
      const evidenceDetail = evidencePreview(outcome.value);
      if (evidenceDetail !== null && evidenceDetail !== undefined) {
        evidence.push({ source: hint.capabilityId, detail: evidenceDetail });
      }
      ctx.log({
        at: new Date().toISOString(), level: 'info',
        code: 'ai_investigation_read_completed',
        message: 'Jev가 선택한 자료 조회를 완료했습니다.',
        data: {
          stepId: step.id,
          capabilityId: hint.capabilityId,
          readIndex: firstReadIndex + index,
          candidateCount: candidates.length,
        },
      });
    }
  }

  const restrictedEvidence = evidence.filter((item) =>
    !decisionEngineCanReceiveEvidence(outputDecisionEngine, ir, cloudAllowed, item.source),
  );
  if (restrictedEvidence.length > 0 && Object.keys(outputPlan.questions).length > 0) {
    throw Object.assign(
      new Error('클라우드 전송이 차단된 조회 데이터로 Jev 구조화 판단을 실행할 수 없습니다.'),
      {
        code: 'ai_input_unavailable',
        data: { stepId: step.id, sources: restrictedEvidence.map((item) => item.source) },
      },
    );
  }

  const jevOutput = await evaluateDecisionOutputs({
    step, ctx, plan: outputPlan, decisionEngine: outputDecisionEngine, decisionInput, evidence,
  });
  const outputFields = outputPlan.modelFields;
  const modelOutput = runModel && (outputFields === undefined || outputFields.length > 0)
    ? await runModel({
        requireDeclaredFields: !allowReads,
        final: true,
        ...(outputFields === undefined ? {} : { outputFields }),
        decisionValues: jevOutput,
      })
    : {};
  const output = { ...modelOutput, ...jevOutput, needMore: false };
  if (allowReads && !hasRequiredOutputFields(step, output)) {
    if (!runModel) {
      throw Object.assign(new Error(`AI 판단 단계 ${step.id}가 선언된 출력 필드를 모두 반환하지 않았습니다.`), { code: 'ai_output_missing' });
    }
    await persistFinalOutput({
      step, ir, ctx, stepResults, evidence, documentRequired, runModel, outputFields, jevOutput,
    });
    return;
  }
  persistOutput({ step, ir, ctx, stepResults, evidence, documentRequired, output });
}

function evidencePreview(value: unknown): string {
  return untrustedEvidencePreview(value);
}

async function persistFinalOutput(context: {
  step: Step & { type: 'ai_decision' };
  ir: WorkflowIR;
  ctx: ConnectorContext;
  stepResults: Record<string, unknown>;
  evidence: Array<{ source: string; detail: string }>;
  documentRequired: boolean;
  runModel: DecisionModelRun;
  outputFields?: string[];
  jevOutput: Record<string, unknown>;
}): Promise<void> {
  const modelOutput = await context.runModel({
    requireDeclaredFields: true,
    final: true,
    ...(context.outputFields === undefined ? {} : { outputFields: context.outputFields }),
    decisionValues: context.jevOutput,
  });
  const output = { ...modelOutput, ...context.jevOutput, needMore: false };
  if (!hasRequiredOutputFields(context.step, output)) {
    throw Object.assign(
      new Error(`AI 판단 단계 ${context.step.id}가 선언된 출력 필드를 모두 반환하지 않았습니다.`),
      { code: 'ai_output_missing' },
    );
  }
  persistOutput({ ...context, output });
}

function persistOutput(context: {
  step: Step & { type: 'ai_decision' };
  ir: WorkflowIR;
  ctx: ConnectorContext;
  stepResults: Record<string, unknown>;
  evidence: Array<{ source: string; detail: string }>;
  documentRequired: boolean;
  output: Record<string, unknown>;
}): void {
  persistDecisionOutput(
    context.step,
    context.output,
    context.ctx,
    context.stepResults,
    hasDecisionEvidenceFromBindings(
      context.step,
      context.ir,
      context.ctx,
      context.stepResults,
      context.evidence,
    ),
    context.documentRequired,
  );
}

import {
  decisionProviderRequestBytesFromError,
  decisionProviderRequestCountFromError,
  type DecisionEvaluationResult,
  type DecisionQuestion,
} from '../../../../contracts/decision.js';
import { fallback } from './jev-router-command.js';
import type { JevChatRouterResult, JevChatRouterTelemetry } from './jev-router-contract.js';
import type { JevWorkflowPlanResult } from './jev-workflow-plan.js';

function decisionRequestBytes(state: unknown, questions: Record<string, DecisionQuestion>): number {
  return new TextEncoder().encode(JSON.stringify({ state, questions })).byteLength;
}

export interface JevRouterTelemetryBase {
  questions: Record<string, DecisionQuestion>;
  routeCandidateCount: number;
  operationCandidateCount: number;
  operationCatalogSize: number;
  operationCatalogMayBeBounded: boolean;
  actionCandidateCount: number;
  actionCatalogSize: number;
  actionCatalogMayBeBounded: boolean;
  operationSelectionMode?: JevChatRouterTelemetry['operationSelectionMode'];
  operationLexicalMatchedOperationCount?: number;
  operationLexicalTopScore?: number;
}

/**
 * Accumulates the router's provider usage across the first-pass evaluation,
 * follow-up evaluations, and planning, so every route reports one telemetry shape.
 */
export class JevRouterTelemetryTracker {
  telemetry: JevChatRouterTelemetry | undefined;
  evaluationCalls = 0;
  private initialRequestBytes = 0;

  constructor(private readonly base: JevRouterTelemetryBase) {}

  /** Records the first-pass evaluation; telemetry exists only when the provider reported usage. */
  recordInitial(evaluation: DecisionEvaluationResult, state: unknown): void {
    this.initialRequestBytes = evaluation.requestBytes ?? decisionRequestBytes(state, this.base.questions);
    this.telemetry = evaluation.model || evaluation.usage || evaluation.providerRequestCount !== undefined
      || evaluation.requestBytes !== undefined
      ? {
          ...(evaluation.model ? { model: evaluation.model } : {}),
          ...(evaluation.usage?.inputTokens === undefined ? {} : { inputTokens: evaluation.usage.inputTokens }),
          ...(evaluation.usage?.outputTokens === undefined ? {} : { outputTokens: evaluation.usage.outputTokens }),
          questionIds: Object.keys(this.base.questions),
          routeCandidateCount: this.base.routeCandidateCount,
          operationCandidateCount: this.base.operationCandidateCount,
          operationCatalogSize: this.base.operationCatalogSize,
          operationCatalogMayBeBounded: this.base.operationCatalogMayBeBounded,
          actionCandidateCount: this.base.actionCandidateCount,
          actionCatalogSize: this.base.actionCatalogSize,
          actionCatalogMayBeBounded: this.base.actionCatalogMayBeBounded,
          ...(this.base.operationSelectionMode === undefined ? {} : { operationSelectionMode: this.base.operationSelectionMode }),
          ...(this.base.operationLexicalMatchedOperationCount === undefined ? {} : {
            operationLexicalMatchedOperationCount: this.base.operationLexicalMatchedOperationCount,
          }),
          ...(this.base.operationLexicalTopScore === undefined ? {} : {
            operationLexicalTopScore: this.base.operationLexicalTopScore,
          }),
          estimatedRequestBytes: this.initialRequestBytes,
          evaluationCalls: this.evaluationCalls,
          providerRequestCount: evaluation.providerRequestCount ?? 1,
        }
      : undefined;
  }

  get firstPassRequestBytes(): number {
    return this.initialRequestBytes;
  }

  update(patch: Partial<JevChatRouterTelemetry>): void {
    if (this.telemetry) this.telemetry = { ...this.telemetry, ...patch };
  }

  recordFollowup(
    followup: DecisionEvaluationResult,
    followupState: unknown,
    followupQuestions: Record<string, DecisionQuestion>,
  ): void {
    const previous = this.telemetry ?? {
      questionIds: Object.keys(this.base.questions),
      routeCandidateCount: this.base.routeCandidateCount,
      operationCandidateCount: this.base.operationCandidateCount,
      operationCatalogSize: this.base.operationCatalogSize,
      operationCatalogMayBeBounded: this.base.operationCatalogMayBeBounded,
      actionCandidateCount: 0,
      actionCatalogSize: this.base.actionCatalogSize,
      actionCatalogMayBeBounded: this.base.actionCatalogMayBeBounded,
      ...(this.base.operationSelectionMode === undefined ? {} : { operationSelectionMode: this.base.operationSelectionMode }),
      providerRequestCount: 1,
      estimatedRequestBytes: this.initialRequestBytes,
      evaluationCalls: 1,
    };
    this.telemetry = {
      ...previous,
      ...(followup.model ? { model: followup.model } : {}),
      ...((previous.inputTokens !== undefined || followup.usage?.inputTokens !== undefined)
        ? { inputTokens: (previous.inputTokens ?? 0) + (followup.usage?.inputTokens ?? 0) }
        : {}),
      ...((previous.outputTokens !== undefined || followup.usage?.outputTokens !== undefined)
        ? { outputTokens: (previous.outputTokens ?? 0) + (followup.usage?.outputTokens ?? 0) }
        : {}),
      questionIds: [...previous.questionIds, ...Object.keys(followupQuestions)],
      estimatedRequestBytes: previous.estimatedRequestBytes
        + (followup.requestBytes ?? decisionRequestBytes(followupState, followupQuestions)),
      evaluationCalls: this.evaluationCalls,
      providerRequestCount: (previous.providerRequestCount ?? previous.evaluationCalls ?? 1)
        + (followup.providerRequestCount ?? 1),
    };
  }

  /** Router telemetry combined with a workflow planner's usage. */
  withPlan(plan: JevWorkflowPlanResult): JevChatRouterTelemetry {
    const telemetry = this.telemetry;
    const baseTelemetry = telemetry ?? {
      questionIds: Object.keys(this.base.questions),
      routeCandidateCount: this.base.routeCandidateCount,
      operationCandidateCount: this.base.operationCandidateCount,
      operationCatalogSize: this.base.operationCatalogSize,
      operationCatalogMayBeBounded: this.base.operationCatalogMayBeBounded,
      actionCandidateCount: this.base.actionCandidateCount,
      actionCatalogSize: this.base.actionCatalogSize,
      actionCatalogMayBeBounded: this.base.actionCatalogMayBeBounded,
      estimatedRequestBytes: this.initialRequestBytes,
      providerRequestCount: 1,
    };
    return {
      ...baseTelemetry,
      estimatedRequestBytes: baseTelemetry.estimatedRequestBytes + plan.telemetry.estimatedRequestBytes,
      inputTokens: baseTelemetry.inputTokens === undefined && plan.telemetry.inputTokens === undefined ? undefined : (baseTelemetry.inputTokens ?? 0) + (plan.telemetry.inputTokens ?? 0),
      outputTokens: baseTelemetry.outputTokens === undefined && plan.telemetry.outputTokens === undefined ? undefined : (baseTelemetry.outputTokens ?? 0) + (plan.telemetry.outputTokens ?? 0),
      evaluationCalls: (telemetry?.evaluationCalls ?? 1) + plan.telemetry.calls,
      providerRequestCount: (telemetry?.providerRequestCount ?? telemetry?.evaluationCalls ?? 1)
        + plan.telemetry.providerRequestCount,
      planningCalls: plan.telemetry.calls,
      planningProviderRequestCount: plan.telemetry.providerRequestCount,
      planningDurationMs: plan.telemetry.durationMs,
      planningStepCount: plan.telemetry.plannedStepCount,
      planningCandidateCount: plan.telemetry.candidateCount,
      planningCandidateCatalogMayBeBounded: plan.telemetry.candidateCatalogMayBeBounded,
      planningEstimatedRequestBytes: plan.telemetry.estimatedRequestBytes,
      planningInputTokens: plan.telemetry.inputTokens,
      planningOutputTokens: plan.telemetry.outputTokens,
      planningModels: plan.telemetry.models,
    };
  }

  /** A provider failure keeps any usage already counted plus the failed request. */
  serviceFailure(error: unknown): JevChatRouterResult {
    const failedProviderRequestCount = decisionProviderRequestCountFromError(error);
    const failedProviderRequestBytes = decisionProviderRequestBytesFromError(error);
    const telemetry = this.telemetry;
    if (telemetry) {
      return {
        ...fallback('service_error'),
        telemetry: {
          ...telemetry,
          evaluationCalls: this.evaluationCalls,
          ...(failedProviderRequestCount === undefined ? {} : {
            providerRequestCount: (telemetry.providerRequestCount ?? 0) + failedProviderRequestCount,
          }),
          ...(failedProviderRequestBytes === undefined ? {} : {
            estimatedRequestBytes: telemetry.estimatedRequestBytes + failedProviderRequestBytes,
          }),
        },
      };
    }
    if (failedProviderRequestCount !== undefined) {
      return {
        kind: 'fallback',
        reason: 'service_error',
        evaluationCalls: this.evaluationCalls,
        providerRequestCount: failedProviderRequestCount,
      };
    }
    return fallback('service_error');
  }
}

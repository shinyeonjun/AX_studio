import type { AuthoritativeRequestAnchor, AuthoritativeRequestBudget } from '../../../contracts/request-anchor.js';
import type { DecisionEvaluationRequest, DecisionEvaluationResult } from '../../../contracts/decision.js';
import type { ReadBudget } from './budget.js';
import type { ReadRegistry } from './registry.js';
import type { CoverageRequirement, ProviderBudgetPolicy, ReadCallInstance, ReadContext,
  ReadExecutionResult, ReadLimits, ReadOperation } from './types.js';

export interface CallbackContext {
  signal: AbortSignal;
  budget: ReadBudget;
}

export interface ReadControllerOptions {
  request: AuthoritativeRequestAnchor;
  context: ReadContext;
  operations: readonly ReadOperation[];
  requirements: readonly CoverageRequirement[];
  limits?: Partial<ReadLimits>;
  requestBudget?: Partial<AuthoritativeRequestBudget>;
  /** All internal HTTP calls must use budget.dispatch when choosing dispatch-guard. */
  providerBudget: ProviderBudgetPolicy;
  signal?: AbortSignal;
  discover(context: CallbackContext & { registry: ReadRegistry; request: AuthoritativeRequestAnchor }): Promise<void> | void;
  decide(request: DecisionEvaluationRequest, context: CallbackContext): Promise<DecisionEvaluationResult>;
  /** Recheck real source/body policy and revisions before dispatch AND publication. */
  authorize(instance: ReadCallInstance, context: CallbackContext): Promise<{
    allowed: boolean; catalogRevision: number; contextRevision: string; code?: string;
  }>;
  executeRead(instance: ReadCallInstance, context: CallbackContext): Promise<ReadExecutionResult>;
}

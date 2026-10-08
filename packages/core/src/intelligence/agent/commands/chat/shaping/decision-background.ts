import type { DecisionEngine } from '../../../../../contracts/decision.js';
import { AGENT_SCOPED_CONTEXT_DECISION_POLICY, boundedAgentScopedContext } from '../../../scoped-context.js';
import type { AgentScopedContextMap } from '../../../scoped-context.js';

/**
 * What this person confirmed for this conversation or work ("VIP는 등급 A", "매출은 결제 완료
 * 금액"), as background for the decisions that shape a table: which rows a filter keeps, what a
 * total counts. Routing already sees it; filters and calculations did not, so "VIP만 보여줘"
 * could not use the definition the person gave.
 */
export function shapingBackground(context: { sessionMemo?: AgentScopedContextMap; workflowPolicy?: AgentScopedContextMap }): Record<string, unknown> | undefined {
  const preferences = boundedAgentScopedContext(context.sessionMemo, context.workflowPolicy);
  return preferences ? { user_confirmed_preferences: preferences, preferences_policy: AGENT_SCOPED_CONTEXT_DECISION_POLICY } : undefined;
}

/** The engine with `background` added to every object-shaped decision state it is asked about. */
export function withDecisionBackground(engine: DecisionEngine, background: Record<string, unknown> | undefined): DecisionEngine {
  if (!background) return engine;
  return {
    evaluate: (request) => engine.evaluate(request.state && typeof request.state === 'object' && !Array.isArray(request.state)
      ? { ...request, state: { ...(request.state as Record<string, unknown>), ...background } }
      : request),
  };
}

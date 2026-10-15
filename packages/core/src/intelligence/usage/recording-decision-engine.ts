import {
  decisionProviderRequestCountFromError,
  type DecisionEngine,
  type DecisionEvaluationRequest,
} from '../../contracts/decision.js';
import { recordUsageCall, type UsageEngine } from './usage-recorder.js';

const RECORDED = Symbol('usage-recorded');

/** The same engine, with every evaluation recorded as a decision call (time, requests, tokens). */
export function withUsageRecording(engine: DecisionEngine, usageEngine: UsageEngine = 'jev'): DecisionEngine {
  if ((engine as { [RECORDED]?: true })[RECORDED]) return engine;
  const recorded: DecisionEngine & { [RECORDED]: true } = {
    [RECORDED]: true,
    ...(engine.dataHandling ? { dataHandling: engine.dataHandling } : {}),
    async evaluate(request: DecisionEvaluationRequest) {
      const startedAt = Date.now();
      try {
        const result = await engine.evaluate(request);
        recordUsageCall({
          engine: usageEngine,
          purpose: 'decision',
          ...(result.model ? { model: result.model } : {}),
          durationMs: Date.now() - startedAt,
          providerRequests: result.providerRequestCount ?? 1,
          ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
          ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
          ...(result.requestBytes !== undefined ? { requestBytes: result.requestBytes } : {}),
          ok: true,
        });
        return result;
      } catch (error) {
        const providerRequests = decisionProviderRequestCountFromError(error);
        recordUsageCall({
          engine: usageEngine,
          purpose: 'decision',
          durationMs: Date.now() - startedAt,
          ...(providerRequests !== undefined ? { providerRequests } : {}),
          ok: false,
        });
        throw error;
      }
    },
  };
  return recorded;
}

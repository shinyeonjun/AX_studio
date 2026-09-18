import type {
  BooleanDecisionAnswer,
  DecisionEngine,
  DecisionQuestion,
} from '../../contracts/decision.js';
import {
  boundDecisionString,
  DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
} from '../../intelligence/decision/context.js';
import type { DiscoveryObservationRef } from '../../contracts/discovery-source.js';
import type { SourceDescriptor } from '../schema.js';
import { rankSources } from './adapters.js';

export interface DiscoverySourceDecisionContext {
  decisionEngine?: DecisionEngine;
  userGoal?: string;
}

function probabilityOf(answer: unknown): number | undefined {
  if (!answer || typeof answer !== 'object') return undefined;
  const candidate = answer as Partial<BooleanDecisionAnswer>;
  if (candidate.type !== 'boolean') return undefined;
  if (typeof candidate.probability !== 'number' || !Number.isFinite(candidate.probability)) return undefined;
  if (candidate.probability < 0 || candidate.probability > 1) return undefined;
  return candidate.probability;
}

/**
 * Semantic source ranking for Work Discovery.
 *
 * Jev is advisory here: it may change ordering, but it never removes a source or
 * bypasses the existing source-read budget. Any provider/transport/schema error
 * falls back to the deterministic token-overlap ranker from main.
 */
export async function rankSourcesForDiscovery(
  sources: SourceDescriptor[],
  observations: DiscoveryObservationRef[],
  decision: DiscoverySourceDecisionContext = {},
): Promise<SourceDescriptor[]> {
  const baseline = rankSources(sources, observations);
  if (!decision.decisionEngine || baseline.length < 2) return baseline;

  const questions: Record<string, DecisionQuestion> = {};
  for (const [index, source] of baseline.entries()) {
    questions[`source_${index}`] = {
      type: 'boolean',
      instructions: {
        task: 'Estimate whether this source is useful for reproducing the observed output from the available inputs.',
        dataPolicy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
        source: {
          id: boundDecisionString(source.id, 256),
          label: boundDecisionString(source.label),
          connector: boundDecisionString(source.connector, 256),
          kind: source.kind,
          profileSummary: source.profileSummary ? boundDecisionString(source.profileSummary) : null,
        },
      },
    };
  }

  try {
    const result = await decision.decisionEngine.evaluate({
      state: {
        userGoal: boundDecisionString(decision.userGoal ?? ''),
        purpose: 'work_discovery_source_ranking',
        observations: observations.map((observation) => ({
          label: boundDecisionString(observation.label ?? ''),
          path: boundDecisionString(observation.path, 512),
          required: observation.required ?? false,
        })),
      },
      questions,
    });

    return baseline
      .map((source, index) => ({
        source,
        baselineIndex: index,
        semanticRelevance: probabilityOf(result.answers[`source_${index}`]) ?? source.relevance,
      }))
      .sort((left, right) => {
        const delta = (right.semanticRelevance ?? 0) - (left.semanticRelevance ?? 0);
        return delta || left.baselineIndex - right.baselineIndex;
      })
      .map(({ source, semanticRelevance }) => ({
        ...source,
        relevance: semanticRelevance,
      }));
  } catch {
    return baseline;
  }
}

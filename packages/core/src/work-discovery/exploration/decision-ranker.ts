import type { DecisionEngine } from '../../contracts/decision.js';
import type { DiscoveryObservationRef } from '../../contracts/discovery-source.js';
import type { SourceDescriptor } from '../schema.js';
import { rankSources } from './adapters.js';

export interface DecisionSourceRankingInput {
  sources: SourceDescriptor[];
  observations: DiscoveryObservationRef[];
  userGoal?: string;
  decisionEngine?: DecisionEngine;
}

function questionId(index: number): string {
  return `source_${index}`;
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Ranks discovery sources semantically when a decision engine is available.
 *
 * The existing lexical ranker remains the fail-open baseline. Jev (or another
 * DecisionEngine) only supplies fuzzy relevance judgments; source reads and
 * downstream replay/validation stay deterministic.
 */
export async function rankSourcesWithDecisionEngine(
  input: DecisionSourceRankingInput,
): Promise<SourceDescriptor[]> {
  const fallback = rankSources(input.sources, input.observations);
  if (!input.decisionEngine || fallback.length === 0) return fallback;

  const questions = Object.fromEntries(
    fallback.map((source, index) => [
      questionId(index),
      {
        type: 'boolean' as const,
        instructions: {
          objective: 'Judge whether this source is likely to contain data needed to reproduce the required output observations.',
          sourceId: source.id,
          sourceLabel: source.label,
          connector: source.connector,
          kind: source.kind,
          profileSummary: source.profileSummary ?? '',
        },
      },
    ]),
  );

  try {
    const result = await input.decisionEngine.evaluate({
      state: {
        userGoal: input.userGoal ?? '',
        observations: input.observations.map((observation) => ({
          path: observation.path,
          label: observation.label ?? '',
          required: observation.required ?? false,
        })),
        sources: fallback.map((source) => ({
          id: source.id,
          label: source.label,
          connector: source.connector,
          kind: source.kind,
          profileSummary: source.profileSummary ?? '',
          lexicalRelevance: source.relevance,
        })),
      },
      questions,
    });

    return fallback
      .map((source, index) => {
        const answer = result.answers[questionId(index)];
        if (!answer || answer.type !== 'boolean') return source;
        return { ...source, relevance: clampProbability(answer.probability) };
      })
      .sort((left, right) => right.relevance - left.relevance);
  } catch {
    return fallback;
  }
}

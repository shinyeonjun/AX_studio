import type { DiscoveryObservationRef } from '../../contracts/discovery-source.js';
import type { SourceDescriptor } from '../schema.js';

export type { ExplorationBudget } from '../../contracts/discovery-source.js';

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean);
}

export function scoreSourceRelevance(source: SourceDescriptor, observations: DiscoveryObservationRef[]): number {
  const labels = observations.flatMap((observation) => [observation.label, observation.path].filter(Boolean) as string[]);
  const haystack = `${source.id} ${source.label} ${source.profileSummary ?? ''}`.toLowerCase();
  let score = 0;
  for (const label of labels) {
    for (const token of tokenize(label)) {
      if (token.length < 2) continue;
      if (haystack.includes(token)) score += 0.2;
    }
  }
  return Math.min(1, score);
}

export function rankSources(sources: SourceDescriptor[], observations: DiscoveryObservationRef[]): SourceDescriptor[] {
  return [...sources]
    .map((source) => ({ ...source, relevance: scoreSourceRelevance(source, observations) }))
    .sort((left, right) => right.relevance - left.relevance);
}

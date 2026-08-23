import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';

export interface ExplorationBudget {
  sourceReadsUsed: number;
  sourceReadsMax: number;
}

export interface SourceProfileResult {
  descriptor: SourceDescriptor;
  table?: TableArtifact;
  fingerprint: string;
}

export interface DiscoverySourceAdapter {
  connector: string;
  listSources(): Promise<SourceDescriptor[]>;
  profileSource(sourceId: string, budget: ExplorationBudget): Promise<SourceProfileResult | null>;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean);
}

export function scoreSourceRelevance(source: SourceDescriptor, observations: OutputObservation[]): number {
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

export function rankSources(sources: SourceDescriptor[], observations: OutputObservation[]): SourceDescriptor[] {
  return [...sources]
    .map((source) => ({ ...source, relevance: scoreSourceRelevance(source, observations) }))
    .sort((left, right) => right.relevance - left.relevance);
}

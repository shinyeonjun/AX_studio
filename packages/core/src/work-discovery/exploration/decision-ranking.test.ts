import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../contracts/decision.js';
import type { SourceDescriptor } from '../schema.js';
import { rankSourcesForDiscovery } from './decision-ranking.js';

const sources: SourceDescriptor[] = [
  {
    id: 'source-a',
    connector: 'fixture',
    label: 'Orders archive',
    kind: 'table',
    relevance: 0,
  },
  {
    id: 'source-b',
    connector: 'fixture',
    label: 'Current sales table',
    kind: 'table',
    relevance: 0,
  },
];

describe('rankSourcesForDiscovery', () => {
  it('uses semantic probabilities to reorder sources without removing any candidates', async () => {
    const engine: DecisionEngine = {
      evaluate: async (request) => {
        expect(Object.keys(request.questions)).toEqual(['source_0', 'source_1']);
        return {
          answers: {
            source_0: { type: 'boolean', probability: 0.18 },
            source_1: { type: 'boolean', probability: 0.91 },
          },
        };
      },
    };

    const ranked = await rankSourcesForDiscovery(sources, [], engine);

    expect(ranked.map((source) => source.id)).toEqual(['source-b', 'source-a']);
    expect(ranked.map((source) => source.relevance)).toEqual([0.91, 0.18]);
  });

  it('falls back to deterministic ranking when the decision engine fails', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => {
        throw new Error('provider unavailable');
      },
    };

    const ranked = await rankSourcesForDiscovery(sources, [], engine);

    expect(ranked.map((source) => source.id)).toEqual(['source-a', 'source-b']);
    expect(ranked.map((source) => source.relevance)).toEqual([0, 0]);
  });
});

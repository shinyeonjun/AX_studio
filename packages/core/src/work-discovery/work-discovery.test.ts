import { describe, expect, it } from 'vitest';
import { observeDocumentArtifact } from './observation/observe-document.js';
import { enumerateCandidates } from './synthesis/enumerator.js';
import { replayCandidates } from './synthesis/replay-runner.js';
import { buildTableArtifact } from '../contracts/artifacts/table-build.js';

describe('work discovery synthesis', () => {
  it('replays a labeled number from a sqlite-like table snapshot', () => {
    const exampleId = 'ex_test';
    const document = {
      id: 'doc_1',
      text: '매출: 1,250만\n비용: 800만',
      pages: [{ index: 0, text: '매출: 1,250만\n비용: 800만' }],
      images: [],
      tables: [],
    };
    const observations = observeDocumentArtifact(exampleId, document);
    expect(observations.length).toBeGreaterThan(0);

    const table = buildTableArtifact({
      id: 'tbl_sales',
      name: 'sales',
      headers: ['label', 'amount'],
      matrix: [['매출', 12_500_000]],
      rowLimit: 10,
      source: { table: 'sales' },
    });

    const sources = [{
      id: 'rdb:sales',
      connector: 'rdb',
      label: 'sales',
      kind: 'table' as const,
      relevance: 1,
    }];

    const candidates = enumerateCandidates(observations, sources, { 'rdb:sales': table });
    const replayed = replayCandidates({
      candidates,
      examples: [{ exampleId, observations }],
      snapshotsByExample: { [exampleId]: { 'rdb:sales': table } },
    });

    expect(replayed.some((candidate) => candidate.replayResults.some((entry) => entry.pass))).toBe(true);
  });
});

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { DiscoverySourceContext, DiscoverySourceProvider, SourceProfileResult } from '../../contracts/discovery-source.js';
import type { InputArtifactDiscoverySourceOptions } from './types.js';

export class InputArtifactDiscoverySourceProvider implements DiscoverySourceProvider {
  readonly connector = 'input_artifact';

  constructor(private readonly options: InputArtifactDiscoverySourceOptions) {}

  async listSources(ctx: DiscoverySourceContext) {
    const descriptors = [];
    for (const artifactId of ctx.inputArtifactIds) {
      const stored = ctx.artifactStore.get(artifactId);
      if (!stored) continue;
      const ext = extname(stored.fileName).toLowerCase();
      if (!['.csv', '.xlsx', '.xls'].includes(ext)) continue;
      descriptors.push({
        id: `input:${artifactId}`,
        connector: 'input_artifact',
        label: stored.fileName,
        kind: 'workbook' as const,
        relevance: 0.9,
        profileSummary: stored.fileName,
        metadata: { artifactId, storedPath: stored.storedPath },
      });
    }
    return descriptors;
  }

  async profileSource(ctx: DiscoverySourceContext, sourceId: string): Promise<SourceProfileResult | null> {
    if (ctx.budget.sourceReadsUsed >= ctx.budget.sourceReadsMax) return null;
    const artifactId = sourceId.replace(/^input:/, '');
    const stored = ctx.artifactStore.get(artifactId);
    if (!stored) return null;
    const { workbook, tables } = this.options.materializeWorkbook(stored.storedPath);
    const firstTableId = workbook.sheets[0]?.tables[0]?.artifactId;
    const table = firstTableId ? tables[firstTableId] : undefined;
    if (!table) return null;
    ctx.budget.sourceReadsUsed += 1;
    const query = { artifactId, path: stored.storedPath, sheet: workbook.sheets[0]?.name };
    return {
      descriptor: {
        id: sourceId,
        connector: 'input_artifact',
        label: stored.fileName,
        kind: 'workbook',
        relevance: 0.9,
        profileSummary: table.columns.map((column) => column.name).join(', '),
        metadata: { artifactId, storedPath: stored.storedPath },
      },
      table,
      fingerprint: createHash('sha256').update(JSON.stringify({ query, rows: table.rows })).digest('hex'),
      queryJson: JSON.stringify(query),
    };
  }
}

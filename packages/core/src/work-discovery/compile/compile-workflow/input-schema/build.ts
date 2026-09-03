import type { InputContract } from '../../../../contracts/output-contract.js';
import type { DiscoveryBlueprint } from '../../../schema.js';
import { collectInputColumns, inputTypeForOutputKind } from './collect.js';

export function buildInputSchemas(
  blueprint: DiscoveryBlueprint,
  readStepBySource: Map<string, string>,
): InputContract[] {
  const columnsBySource = new Map<string, Map<string, InputContract['columns'][number]['type']>>();
  for (const field of blueprint.fields) {
    if (!field.mapping) continue;
    const expectedType = inputTypeForOutputKind(
      blueprint.outputContract?.fields.find((entry) => entry.path === field.outputPath)?.kind,
    );
    collectInputColumns(field.mapping, columnsBySource, expectedType);
  }

  return [...columnsBySource.entries()].flatMap(([sourceId, columns]) => {
    const stepId = readStepBySource.get(sourceId);
    if (!stepId || columns.size === 0) return [];
    return [{
      sourceId,
      stepId,
      columns: [...columns.entries()].map(([name, type]) => ({ name, type })),
    }];
  });
}

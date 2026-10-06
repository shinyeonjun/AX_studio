import type { DiscoveryBlueprint } from '../../schema.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { sanitizeStepId } from './helpers.js';

export function readStepForSource(
  source: DiscoveryBlueprint['sources'][number],
  pathInput = 'sourcePath',
): WorkflowIR['steps'][number] | undefined {
  if (source.connector === 'input_artifact' || source.connector === 'local_sheet') {
    const folderId = source.metadata?.folderId;
    return {
      type: 'action',
      id: 'read_' + sanitizeStepId(source.id),
      connector: 'local_sheet',
      action: 'read',
      params: {
        path: `{{${pathInput}}}`,
        // From a connected folder, each run reads the newest file named like the example
        // (next month's export), not the example file again.
        ...(typeof folderId === 'string' && folderId.trim() ? { folderId: folderId.trim(), followNewest: true } : {}),
      },
      sideEffect: 'NONE',
    };
  }
  if (source.connector === 'rdb') {
    const table = source.id.replace(/^rdb:/, '');
    return {
      type: 'action',
      id: 'read_' + sanitizeStepId(source.id),
      connector: 'rdb',
      action: 'query.read',
      params: { table },
      sideEffect: 'NONE',
    };
  }
  return undefined;
}

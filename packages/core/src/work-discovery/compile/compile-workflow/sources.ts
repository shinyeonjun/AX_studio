import type { DiscoveryBlueprint } from '../../schema.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { sanitizeStepId } from './helpers.js';

export function readStepForSource(
  source: DiscoveryBlueprint['sources'][number],
): WorkflowIR['steps'][number] | undefined {
  const metadata = source.metadata ?? {};
  if (source.connector === 'input_artifact' || source.connector === 'local_sheet') {
    const path = typeof metadata.storedPath === 'string'
      ? metadata.storedPath
      : typeof metadata.path === 'string'
        ? metadata.path
        : source.id.replace(/^(input|sheet):/, '');
    return {
      type: 'action',
      id: 'read_' + sanitizeStepId(source.id),
      connector: 'local_sheet',
      action: 'read',
      params: { path: '{{sourcePath}}' },
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

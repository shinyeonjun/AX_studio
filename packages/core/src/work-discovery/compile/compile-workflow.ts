import type { DiscoveryBlueprint } from '../schema.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { sourceIdFromExpr } from './blueprint.js';

export function compileBlueprintToWorkflow(
  blueprint: DiscoveryBlueprint,
  options: { name?: string } = {},
): WorkflowIR {
  const steps: WorkflowIR['steps'] = [];
  const sourceIds = [
    ...new Set(
      blueprint.fields
        .map((field) => (field.mapping ? sourceIdFromExpr(field.mapping) : undefined))
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  for (const [index, sourceId] of sourceIds.entries()) {
    steps.push({
      type: 'action',
      id: `read_${index + 1}`,
      connector: sourceId.startsWith('rdb:') ? 'rdb' : 'local_sheet',
      action: sourceId.startsWith('rdb:') ? 'query.read' : 'read',
      params: sourceId.startsWith('rdb:')
        ? { table: sourceId.replace(/^rdb:/, '') }
        : { path: sourceId.replace(/^sheet:/, '') },
      sideEffect: 'NONE',
    });
  }

  if (steps.length > 0) {
    steps.push({
      type: 'action',
      id: 'compose_report',
      connector: 'transform',
      action: 'table_to_text',
      params: {},
      sideEffect: 'NONE',
    });
  }

  const trigger = blueprint.triggerProposal &&
    typeof blueprint.triggerProposal === 'object' &&
    (blueprint.triggerProposal as { type?: string }).type === 'schedule'
    ? blueprint.triggerProposal as WorkflowIR['trigger']
    : { type: 'manual' as const };

  const permissions: Record<string, boolean> = {};
  for (const sourceId of sourceIds) {
    if (sourceId.startsWith('rdb:')) permissions['rdb.read'] = true;
    if (sourceId.startsWith('sheet:')) permissions['local_sheet.read'] = true;
  }

  return {
    version: 1,
    name: options.name ?? blueprint.name,
    goal: blueprint.goal,
    trigger,
    inputs: [],
    steps,
    permissions,
    approval: [],
    allowExternalAuto: false,
    assumptions: ['work discovery에서 컴파일됨'],
    sideEffects: {},
    dataPolicy: {},
    document: JSON.stringify({ origin: 'discovery', blueprintId: blueprint.id }),
  };
}

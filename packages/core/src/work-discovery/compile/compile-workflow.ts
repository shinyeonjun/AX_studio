import { createHash } from 'node:crypto';
import type { DiscoveryBlueprint } from '../schema.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { sourceIdFromExpr } from './blueprint.js';
import type { TransformExpr } from '../synthesis/transform-dsl.js';

function sanitizeStepId(value: string): string {
  const slug = value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 8);
  return `${slug || 'step'}_${hash}`;
}

function readStepForSource(source: DiscoveryBlueprint['sources'][number]): WorkflowIR['steps'][number] | undefined {
  const metadata = source.metadata ?? {};
  if (source.connector === 'input_artifact' || source.connector === 'local_sheet') {
    const path = typeof metadata.storedPath === 'string'
      ? metadata.storedPath
      : typeof metadata.path === 'string'
        ? metadata.path
        : source.id.replace(/^(input|sheet):/, '');
    return {
      type: 'action',
      id: `read_${sanitizeStepId(source.id)}`,
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
      id: `read_${sanitizeStepId(source.id)}`,
      connector: 'rdb',
      action: 'query.read',
      params: { table },
      sideEffect: 'NONE',
    };
  }
  return undefined;
}

function collectSourceIds(expr: TransformExpr, bucket: Set<string>): void {
  const sourceId = sourceIdFromExpr(expr);
  if (sourceId) bucket.add(sourceId);
}

export function compileBlueprintToWorkflow(
  blueprint: DiscoveryBlueprint,
  options: { name?: string; defaultSourcePath?: string } = {},
): WorkflowIR {
  const steps: WorkflowIR['steps'] = [];
  const sourceIds = new Set<string>();
  for (const field of blueprint.fields) {
    if (field.mapping) collectSourceIds(field.mapping, sourceIds);
  }

  const sourceById = new Map(blueprint.sources.map((source) => [source.id, source]));
  const readStepBySource = new Map<string, string>();

  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId) ?? {
      id: sourceId,
      connector: sourceId.startsWith('rdb:') ? 'rdb' : 'input_artifact',
      metadata: sourceId.startsWith('sheet:') ? { path: sourceId.replace(/^sheet:/, '') } : {},
    };
    const readStep = readStepForSource(source);
    if (!readStep || readStep.type !== 'action') continue;
    steps.push(readStep);
    readStepBySource.set(sourceId, readStep.id);
  }

  for (const field of blueprint.fields) {
    if (!field.mapping) continue;
    const sourceId = sourceIdFromExpr(field.mapping);
    const readStepId = sourceId ? readStepBySource.get(sourceId) : undefined;
    steps.push({
      type: 'action',
      id: `eval_${sanitizeStepId(field.outputPath)}`,
      connector: 'transform',
      action: 'evaluate',
      params: {
        expr: field.mapping,
        discoverySourceId: sourceId,
        outputPath: field.outputPath,
      },
      bindings: readStepId
        ? { table: { from: readStepId, output: 'sheet' } }
        : undefined,
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
    if (sourceId.startsWith('input:') || sourceId.startsWith('sheet:')) permissions['local_sheet.read'] = true;
  }
  permissions['transform.evaluate'] = true;

  return {
    version: 1,
    name: options.name ?? blueprint.name,
    goal: blueprint.goal,
    trigger,
    inputs: ['sourcePath'],
    steps,
    permissions,
    approval: [],
    allowExternalAuto: false,
    assumptions: ['work discovery에서 컴파일됨'],
    sideEffects: {},
    dataPolicy: {},
    document: JSON.stringify({
      origin: 'discovery',
      blueprintId: blueprint.id,
      defaultSourcePath: options.defaultSourcePath,
      fields: blueprint.fields.map((field) => ({
        outputPath: field.outputPath,
        mapping: field.mapping,
      })),
    }),
  };
}

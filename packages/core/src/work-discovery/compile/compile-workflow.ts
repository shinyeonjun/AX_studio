import { createHash } from 'node:crypto';
import type { DiscoveryBlueprint } from '../schema.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { snapshotBindingPort } from '../../workflow/port-binding.js';
import { sourceIdFromExpr } from './blueprint.js';
import type { TransformExpr } from '../../workflow/transform-expr/dsl.js';
import type {
  InputContract,
  InputContractColumnType,
} from '../../contracts/output-contract.js';

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

function outputPortForSourceId(sourceId: string): 'rows' | 'sheet' {
  return sourceId.startsWith('rdb:') ? 'rows' : 'sheet';
}

function collectSourceIds(expr: TransformExpr, bucket: Set<string>): void {
  for (const sourceId of sourceIdsInExpr(expr)) bucket.add(sourceId);
}

function sourceIdsInExpr(expr: TransformExpr): string[] {
  if (expr.op === 'source') return [expr.sourceId];
  if (expr.op === 'ratio') {
    return [...new Set([
      ...sourceIdsInExpr(expr.numerator),
      ...sourceIdsInExpr(expr.denominator),
    ])];
  }
  return sourceIdsInExpr(expr.input);
}

function mergeColumnType(
  current: InputContractColumnType | undefined,
  next: InputContractColumnType,
): InputContractColumnType {
  if (!current || current === next) return next;
  return 'unknown';
}

function addColumnRequirement(
  bucket: Map<string, Map<string, InputContractColumnType>>,
  sourceId: string,
  name: string,
  type: InputContractColumnType,
): void {
  const columns = bucket.get(sourceId) ?? new Map<string, InputContractColumnType>();
  columns.set(name, mergeColumnType(columns.get(name), type));
  bucket.set(sourceId, columns);
}

function addColumnsForSources(
  bucket: Map<string, Map<string, InputContractColumnType>>,
  sourceIds: string[],
  names: string[],
  type: InputContractColumnType,
): void {
  for (const sourceId of sourceIds) {
    for (const name of names) addColumnRequirement(bucket, sourceId, name, type);
  }
}

function collectConditionColumns(
  condition: unknown,
  bucket: Map<string, Map<string, InputContractColumnType>>,
  sourceIds: string[],
): void {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return;
  const record = condition as Record<string, unknown>;
  if (typeof record.ref === 'string') {
    addColumnsForSources(bucket, sourceIds, [record.ref], 'unknown');
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectConditionColumns(value, bucket, sourceIds);
  }
}

function collectInputColumns(
  expr: TransformExpr,
  bucket: Map<string, Map<string, InputContractColumnType>>,
  expectedType: InputContractColumnType = 'unknown',
): void {
  switch (expr.op) {
    case 'source':
      return;
    case 'column':
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), [expr.name], expectedType);
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'filter':
      collectConditionColumns(expr.where, bucket, sourceIdsInExpr(expr.input));
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'aggregate':
      if (expr.column) {
        addColumnsForSources(bucket, sourceIdsInExpr(expr.input), [expr.column], 'number');
      }
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'ratio':
      collectInputColumns(expr.numerator, bucket, 'number');
      collectInputColumns(expr.denominator, bucket, 'number');
      return;
    case 'lookup':
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), [expr.keyColumn], 'unknown');
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), [expr.valueColumn], expectedType);
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'select':
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), expr.columns, 'unknown');
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'sort':
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), expr.by.map((entry) => entry.column), 'unknown');
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'limit':
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
  }
}

function inputTypeForOutputKind(kind: string | undefined): InputContractColumnType {
  if (kind === 'number') return 'number';
  if (kind === 'text') return 'string';
  if (kind === 'date') return 'date';
  return 'unknown';
}

function buildInputSchemas(
  blueprint: DiscoveryBlueprint,
  readStepBySource: Map<string, string>,
): InputContract[] {
  const columnsBySource = new Map<string, Map<string, InputContractColumnType>>();
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

function mergeInputSchemas(
  existing: InputContract[],
  generated: InputContract[],
): InputContract[] {
  const merged = new Map<string, InputContract>();
  for (const schema of [...existing, ...generated]) {
    const key = `${schema.sourceId}\0${schema.stepId}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, schema);
      continue;
    }
    const columns = new Map(previous.columns.map((column) => [column.name, column.type]));
    for (const column of schema.columns) {
      columns.set(column.name, mergeColumnType(columns.get(column.name), column.type));
    }
    merged.set(key, {
      ...previous,
      columns: [...columns.entries()].map(([name, type]) => ({ name, type })),
    });
  }
  return [...merged.values()];
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
    const bindings: Record<string, { from: string; output: 'rows' | 'sheet' }> = {};
    if (sourceId && readStepId) {
      bindings.table = { from: readStepId, output: outputPortForSourceId(sourceId) };
    }
    for (const referencedSourceId of sourceIdsInExpr(field.mapping)) {
      if (referencedSourceId === sourceId) continue;
      const referencedReadStepId = readStepBySource.get(referencedSourceId);
      if (!referencedReadStepId) continue;
      bindings[snapshotBindingPort(referencedSourceId)] = {
        from: referencedReadStepId,
        output: outputPortForSourceId(referencedSourceId),
      };
    }
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
      bindings: Object.keys(bindings).length > 0 ? bindings : undefined,
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

  const outputContract = blueprint.outputContract
    ? {
      ...blueprint.outputContract,
      inputSchemas: mergeInputSchemas(
        blueprint.outputContract.inputSchemas,
        buildInputSchemas(blueprint, readStepBySource),
      ),
    }
    : undefined;

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
    outputContract,
    document: JSON.stringify({
      origin: 'discovery',
      blueprintId: blueprint.id,
      sessionId: blueprint.sessionId,
      defaultSourcePath: options.defaultSourcePath,
      fields: blueprint.fields.map((field) => ({
        outputPath: field.outputPath,
        mapping: field.mapping,
      })),
    }),
  };
}

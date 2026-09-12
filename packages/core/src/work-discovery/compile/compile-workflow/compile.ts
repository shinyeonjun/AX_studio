import type { DiscoveryBlueprint } from '../../schema.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { snapshotBindingPort } from '../../../workflow/port-binding.js';
import { sourceIdFromExpr } from '../blueprint.js';
import {
  collectSourceIds,
  outputPortForSourceId,
  sourceIdsInExpr,
  sanitizeStepId,
} from './helpers.js';
import { buildInputSchemas } from './input-schema/build.js';
import { mergeInputSchemas } from './input-schema/merge.js';
import { readStepForSource } from './sources.js';

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
  const sourceInputs: Record<string, string> = {};
  const inputs: string[] = [];
  const fileSourceIds = [...sourceIds].filter(id => {
    const connector = sourceById.get(id)?.connector;
    return connector === 'input_artifact' || connector === 'local_sheet' ||
      (!connector && !id.startsWith('rdb:'));
  });

  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId) ?? {
      id: sourceId,
      connector: sourceId.startsWith('rdb:') ? 'rdb' : 'input_artifact',
      metadata: sourceId.startsWith('sheet:') ? { path: sourceId.replace(/^sheet:/, '') } : {},
    };
    const pathInput = fileSourceIds.length === 1 ? 'sourcePath' : 'sourcePath_' + sanitizeStepId(sourceId);
    if (fileSourceIds.includes(sourceId)) {
      inputs.push(pathInput);
      const path = source.metadata?.storedPath ?? source.metadata?.path ??
        (fileSourceIds.length === 1 ? options.defaultSourcePath : undefined);
      if (typeof path === 'string' && path.trim()) sourceInputs[pathInput] = path;
    }
    const readStep = readStepForSource(source, pathInput);
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
      id: 'eval_' + sanitizeStepId(field.outputPath),
      connector: 'transform',
      action: 'evaluate',
      params: {
        expr: field.mapping,
        discoverySourceId: sourceId,
        outputPath: field.outputPath,
        outputLabel: field.label,
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
    inputs,
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
      sourceInputs,
      fields: blueprint.fields.map((field) => ({
        outputPath: field.outputPath,
        mapping: field.mapping,
      })),
    }),
  };
}

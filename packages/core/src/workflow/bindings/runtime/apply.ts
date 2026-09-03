import { SNAPSHOT_BINDING_PREFIX } from '../../port-binding.js';
import { isConcreteParamValue } from '../ports.js';
import type { Step, WorkflowIR } from '../../schema.js';
import { resolveBindingValue } from './resolve.js';

function applyBoundValueToParams(
  inputPort: string,
  value: unknown,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (value == null) return params;

  if (inputPort.startsWith(SNAPSHOT_BINDING_PREFIX)) {
    const sourceId = inputPort.slice(SNAPSHOT_BINDING_PREFIX.length);
    if (!sourceId) return params;
    const existingTables =
      params.tables && typeof params.tables === 'object' && !Array.isArray(params.tables)
        ? params.tables as Record<string, unknown>
        : {};
    return {
      ...params,
      tables: { ...existingTables, [sourceId]: value },
    };
  }

  if (inputPort === 'source') {
    if (typeof value === 'object') {
      const next: Record<string, unknown> = { ...params, file: value };
      delete next.path;
      return next;
    }
    if (typeof value === 'string') {
      const next: Record<string, unknown> = { ...params, path: value };
      delete next.file;
      return next;
    }
    return params;
  }

  if (inputPort === 'text' || inputPort === 'body') {
    if (typeof value === 'string') return { ...params, [inputPort]: value };
    // A structured result is not message text. The binding must name the
    // declared string field explicitly; otherwise required input validation
    // fails before an external connector is called.
    return params;
  }

  if (inputPort === 'message') {
    const next: Record<string, unknown> = { ...params, message: value };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const messageId = record.messageId ?? record.id;
      if (typeof messageId === 'string' && messageId.trim()) {
        next.messageId = messageId.trim();
      }
    }
    return next;
  }

  return { ...params, [inputPort]: value };
}

export function applyStepBindings(
  step: Extract<Step, { type: 'action' }>,
  ir: WorkflowIR,
  params: Record<string, unknown>,
  stepResults: Record<string, unknown>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  if (!step.bindings) return params;

  let merged = { ...params };
  for (const [inputPort, binding] of Object.entries(step.bindings)) {
    const forceFolderTriggerSource =
      ir.trigger?.type === 'local_folder.new_file' &&
      inputPort === 'source' &&
      binding.from === 'trigger';
    if (
      merged[inputPort] != null &&
      isConcreteParamValue(merged[inputPort]) &&
      !forceFolderTriggerSource
    ) {
      continue;
    }
    const value = resolveBindingValue(binding, ir, stepResults, variables);
    merged = applyBoundValueToParams(inputPort, value, merged);
  }
  return merged;
}

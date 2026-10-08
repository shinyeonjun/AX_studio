import type { ConnectorCapability } from '../../../../../catalog/capability-types.js';
import { contractTypesCompatible } from '../../../../../contracts/compatibility.js';
import { capabilityActionName } from '../../../../../catalog/capability-graph.js';
import { hasConcreteParamForPort, paramValueForInputPort } from '../../../../../workflow/bindings/ports/params.js';
import type { PortBinding } from '../../../../../workflow/port-binding.js';
import type { JevWorkflowOutputHint } from './jev-workflow-plan-types.js';
import { CapabilityIOSchema } from '../../../../../contracts/capability-io.js';
import { TableArtifactSchema } from '../../../../../contracts/artifacts/table.js';
import { DocumentArtifactSchema } from '../../../../../contracts/artifacts/document.js';
import { HttpResponseArtifactSchema } from '../../../../../contracts/artifacts/http-response.js';

export interface ContractPlanStep {
  id: string;
  capability: ConnectorCapability;
  params: Record<string, unknown>;
  bindings: Record<string, PortBinding>;
}

/** Host-only structural validation; no model verdict authorizes execution. */
export function validateJevPlan<T extends ContractPlanStep>(steps: readonly T[], seeds: readonly JevWorkflowOutputHint[]) {
  const errors: string[] = [];
  const conflictedIds = new Set<string>();
  const pendingInputs: Array<{ stepId: string; parameter: string }> = [];
  const ids = new Set<string>();
  const fail = (id: string, code: string) => { errors.push(code); conflictedIds.add(id); };
  for (const step of steps) {
    if (step.capability.io && !CapabilityIOSchema.safeParse(step.capability.io).success) fail(step.id, 'invalid_contract');
    if (!step.id || ids.has(step.id) || seeds.some(({ from }) => from === step.id)) fail(step.id, 'duplicate_id');
    ids.add(step.id);
  }
  const outputs = [...seeds, ...steps.flatMap(step => Object.entries(step.capability.io?.outputs ?? {}).map(([output, type]) => ({ from: step.id, output, type })))];
  const outputIds = new Set<string>();
  for (const output of outputs) {
    const key = JSON.stringify([output.from, output.output]);
    if (outputIds.has(key)) fail(output.from, 'duplicate_output');
    outputIds.add(key);
  }
  for (const step of steps) {
    const action = { type: 'action' as const, id: step.id, connector: step.capability.connector,
      action: capabilityActionName(step.capability), params: step.params, sideEffect: step.capability.sideEffect ?? 'NONE' as const };
    const inputs = step.capability.io?.inputs ?? {};
    // Dynamic refs must go through validated bindings, never bypass them as params.
    if (Object.values(step.params).some(value => value && typeof value === 'object' && 'ref' in value)) fail(step.id, 'unvalidated_parameter_reference');
    for (const [port, binding] of Object.entries(step.bindings)) {
      const expected = inputs[port];
      const source = outputs.find(output => output.from === binding.from && output.output === binding.output);
      if (!expected) fail(step.id, 'unknown_input');
      else if (binding.from === step.id) fail(step.id, 'self_reference');
      else if (!source) fail(step.id, 'unknown_output');
      else if (!contractTypesCompatible(source.type, expected)) fail(step.id, 'type_mismatch');
      if (hasConcreteParamForPort(action, port)) fail(step.id, 'duplicate_input');
    }
    for (const [port, type] of Object.entries(inputs)) {
      if (hasConcreteParamForPort(action, port)) {
        const value = paramValueForInputPort(action, port);
        const schema = type === 'TableArtifact' ? TableArtifactSchema : type === 'DocumentArtifact' ? DocumentArtifactSchema : type === 'HttpResponseArtifact' ? HttpResponseArtifactSchema : undefined;
        if (schema && !schema.safeParse(value).success) fail(step.id, 'literal_type_mismatch');
        continue;
      }
      if (step.bindings[port]) continue;
      const form = step.capability.kind === 'write' && type === 'TextArtifact' && step.capability.params.find(param =>
        param.required && hasConcreteParamForPort({ ...action, params: { [param.name]: 'pending-host-input' } }, port));
      if (form) pendingInputs.push({ stepId: step.id, parameter: form.name });
      else fail(step.id, 'missing_input');
    }
    for (const param of step.capability.params.filter(param => param.required)) {
      const value = step.params[param.name];
      if (value !== undefined && value !== null && value !== '') continue;
      const supplied = Object.keys(step.bindings).some(port => hasConcreteParamForPort({ ...action, params: { [param.name]: 'bound' } }, port));
      if (supplied) continue;
      if (step.capability.kind === 'write') {
        if (!pendingInputs.some(p => p.stepId === step.id && p.parameter === param.name)) pendingInputs.push({ stepId: step.id, parameter: param.name });
      } else fail(step.id, 'missing_parameter');
    }
  }
  const remaining = [...steps];
  const ordered: T[] = [];
  const readyIds = new Set(seeds.map(s => s.from));
  while (remaining.length) {
    const index = remaining.findIndex(step => Object.values(step.bindings).every(binding => readyIds.has(binding.from)));
    if (index < 0) { for (const step of remaining) fail(step.id, 'cycle_or_unknown_reference'); break; }
    const next = remaining.splice(index, 1)[0]!;
    ordered.push(next); readyIds.add(next.id);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], conflictedIds, ordered, pendingInputs };
}

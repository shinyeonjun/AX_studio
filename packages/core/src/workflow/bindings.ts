import { z } from 'zod';
import type { ContractTypeName } from '../contracts/capability-io.js';
import { contractTypesCompatible } from '../contracts/compatibility.js';
import {
  actionInputTypes,
  actionOutputTypes,
  triggerCapabilityId,
  triggerOutputTypes,
} from '../catalog/capability-contracts.js';
import { getCapability } from '../catalog/capabilities.js';
import { resolveCapability } from '../catalog/capability-graph.js';
import { fileRefFromExecutionVariables, fileRefFromTriggerPayload } from '../contracts/mappers.js';
import { skipInLinearScan, stepsById } from '../runtime/control-flow.js';
import type { Step, Trigger, WorkflowIR } from './schema.js';

export const PortBindingSchema = z.object({
  from: z.union([z.literal('trigger'), z.string()]),
  output: z.string(),
});

export type PortBinding = z.infer<typeof PortBindingSchema>;

interface AvailableOutput {
  from: 'trigger' | string;
  port: string;
  type: ContractTypeName;
}

function triggerOutputPorts(trigger: Trigger | undefined): AvailableOutput[] {
  if (!trigger) return [];
  const capId = triggerCapabilityId(trigger.type);
  if (!capId) return [];

  const cap = getCapability(capId);
  if (!cap?.io?.outputs) return [];
  return Object.entries(cap.io.outputs).map(([port, type]) => ({
    from: 'trigger' as const,
    port,
    type,
  }));
}

function stepOutputPorts(step: Extract<Step, { type: 'action' }>): AvailableOutput[] {
  const cap = resolveCapability(step.connector, step.action);
  if (!cap?.io?.outputs) return [];
  return Object.entries(cap.io.outputs).map(([port, type]) => ({
    from: step.id,
    port,
    type: type as ContractTypeName,
  }));
}

function aiDecisionOutputPorts(step: Extract<Step, { type: 'ai_decision' }>): AvailableOutput[] {
  return [
    { from: step.id, port: 'text', type: 'TextArtifact' },
    { from: step.id, port: 'result', type: 'JsonArtifact' },
  ];
}

function findCompatibleSource(
  available: AvailableOutput[],
  inputType: ContractTypeName,
): AvailableOutput | undefined {
  for (let index = available.length - 1; index >= 0; index -= 1) {
    const candidate = available[index]!;
    if (contractTypesCompatible(candidate.type, inputType)) return candidate;
  }
  return undefined;
}

function isConcreteParamValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('{{');
}

function hasConcreteParamForPort(step: Extract<Step, { type: 'action' }>, inputPort: string): boolean {
  if (inputPort === 'source') {
    return isConcreteParamValue(step.params?.path) || Boolean(step.params?.file);
  }
  return isConcreteParamValue(step.params?.[inputPort]);
}

function inferStepBindings(
  step: Step,
  available: AvailableOutput[],
  ir: WorkflowIR,
  guaranteedSources: Set<string | 'trigger'>,
): Step {
  if (step.type !== 'action') return step;

  const cap = resolveCapability(step.connector, step.action);
  const inputPorts = cap?.io?.inputs ?? {};
  const bindings = { ...(step.bindings ?? {}) };

  for (const [inputPort, inputType] of Object.entries(inputPorts)) {
    if (bindings[inputPort] || hasConcreteParamForPort(step, inputPort)) continue;
    const source = findCompatibleSource(available, inputType as ContractTypeName);
    if (!source) continue;
    if (source.from !== 'trigger' && !guaranteedSources.has(source.from)) continue;
    bindings[inputPort] = { from: source.from, output: source.port };
  }

  return Object.keys(bindings).length > 0 ? { ...step, bindings } : step;
}

function mergeBranchAvailable(
  base: AvailableOutput[],
  thenAvailable: AvailableOutput[],
  elseAvailable: AvailableOutput[],
): AvailableOutput[] {
  const key = (item: AvailableOutput) => `${item.from}:${item.port}`;
  const baseKeys = new Set(base.map(key));
  const thenAdded = thenAvailable.filter((item) => !baseKeys.has(key(item)));
  const elseKeys = new Set(elseAvailable.map(key));
  const shared = thenAdded.filter((item) => elseKeys.has(key(item)));
  return [...base, ...shared];
}

function mergeGuaranteedSources(
  base: Set<string | 'trigger'>,
  thenSources: Set<string | 'trigger'>,
  elseSources: Set<string | 'trigger'>,
): Set<string | 'trigger'> {
  const sharedBranchSteps = [...thenSources].filter(
    (source) => source !== 'trigger' && elseSources.has(source),
  );
  return new Set([...base, ...sharedBranchSteps]);
}

function inferSequenceBindings(
  sequence: Step[],
  available: AvailableOutput[],
  guaranteedSources: Set<string | 'trigger'>,
  ir: WorkflowIR,
  allSteps: Step[],
  updated: Map<string, Step>,
): { available: AvailableOutput[]; guaranteedSources: Set<string | 'trigger'> } {
  let currentAvailable = [...available];
  let currentGuaranteed = new Set(guaranteedSources);

  for (const step of sequence) {
    if (step.type === 'if') {
      const thenResult = inferSequenceBindings(
        stepsById(allSteps, step.thenStepIds),
        currentAvailable,
        currentGuaranteed,
        ir,
        allSteps,
        updated,
      );
      const elseResult = inferSequenceBindings(
        stepsById(allSteps, step.elseStepIds ?? []),
        currentAvailable,
        currentGuaranteed,
        ir,
        allSteps,
        updated,
      );
      updated.set(step.id, step);
      currentAvailable = mergeBranchAvailable(currentAvailable, thenResult.available, elseResult.available);
      currentGuaranteed = mergeGuaranteedSources(
        currentGuaranteed,
        thenResult.guaranteedSources,
        elseResult.guaranteedSources,
      );
      continue;
    }

    const inferred = inferStepBindings(step, currentAvailable, ir, currentGuaranteed);
    updated.set(inferred.id, inferred);
    if (inferred.type === 'action') {
      currentAvailable.push(...stepOutputPorts(inferred));
      currentGuaranteed.add(inferred.id);
    } else if (inferred.type === 'ai_decision') {
      currentAvailable.push(...aiDecisionOutputPorts(inferred));
      currentGuaranteed.add(inferred.id);
    }
  }

  return { available: currentAvailable, guaranteedSources: currentGuaranteed };
}

export function inferWorkflowBindings(ir: WorkflowIR): WorkflowIR {
  const skip = skipInLinearScan(ir.steps);
  const linear = ir.steps.filter((step) => !skip.has(step.id));
  const updated = new Map<string, Step>();
  inferSequenceBindings(
    linear,
    [...triggerOutputPorts(ir.trigger)],
    new Set(['trigger']),
    ir,
    ir.steps,
    updated,
  );
  return {
    ...ir,
    steps: ir.steps.map((step) => updated.get(step.id) ?? step),
  };
}

export function resolveTriggerOutput(
  outputPort: string,
  variables: Record<string, unknown>,
): unknown {
  if (outputPort === 'file') {
    return fileRefFromExecutionVariables(variables);
  }
  if (outputPort === 'message') {
    return fileRefFromTriggerPayload(variables) ?? {
      messageId: variables.messageId,
      channel: variables.channel,
      text: variables.text,
      from: variables.from,
      subject: variables.subject,
      snippet: variables.snippet,
    };
  }
  return variables[outputPort];
}

export function extractStepOutput(
  step: Extract<Step, { type: 'action' }>,
  outputPort: string,
  data: unknown,
): unknown {
  if (data == null) return undefined;

  const cap = resolveCapability(step.connector, step.action);
  const outputs = cap?.io?.outputs;
  if (!outputs || !(outputPort in outputs)) {
    return data;
  }

  if (outputPort === 'text' && typeof data === 'object' && data !== null && 'text' in data) {
    return (data as Record<string, unknown>).text;
  }
  if (outputPort === 'body' && typeof data === 'object' && data !== null && 'body' in data) {
    return (data as Record<string, unknown>).body;
  }
  if (outputPort === 'rows' && Array.isArray(data)) return data;
  if (outputPort === 'sheet' && Array.isArray(data)) return data;
  if (outputPort === 'document' || outputPort === 'table' || outputPort === 'file') return data;

  if (typeof data === 'object' && outputPort in (data as Record<string, unknown>)) {
    return (data as Record<string, unknown>)[outputPort];
  }

  return data;
}

export function resolveBindingValue(
  binding: PortBinding,
  ir: WorkflowIR,
  stepResults: Record<string, unknown>,
  variables: Record<string, unknown>,
): unknown {
  if (binding.from === 'trigger') {
    return resolveTriggerOutput(binding.output, variables);
  }

  const step = ir.steps.find((candidate) => candidate.id === binding.from);
  const data = stepResults[binding.from];
  if (!step || step.type !== 'action') return data;
  return extractStepOutput(step, binding.output, data);
}

function applyBoundValueToParams(
  inputPort: string,
  value: unknown,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (value == null) return params;

  if (inputPort === 'source') {
    if (typeof value === 'object') return { ...params, file: value };
    if (typeof value === 'string') return { ...params, path: value };
    return params;
  }

  if (inputPort === 'text' || inputPort === 'body') {
    if (typeof value === 'string') return { ...params, [inputPort]: value };
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      for (const key of ['text', 'body', 'conclusion']) {
        if (typeof record[key] === 'string' && String(record[key]).trim()) {
          return { ...params, [inputPort]: record[key] };
        }
      }
    }
    return params;
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
    if (merged[inputPort] != null && isConcreteParamValue(merged[inputPort])) continue;
    const value = resolveBindingValue(binding, ir, stepResults, variables);
    merged = applyBoundValueToParams(inputPort, value, merged);
  }
  return merged;
}

export function bindingOutputType(
  binding: PortBinding,
  ir: WorkflowIR,
): ContractTypeName | undefined {
  if (binding.from === 'trigger') {
    const capId = ir.trigger ? triggerCapabilityId(ir.trigger.type) : undefined;
    if (!capId) return undefined;
    return getCapability(capId)?.io?.outputs?.[binding.output] as ContractTypeName | undefined;
  }

  const step = ir.steps.find((candidate) => candidate.id === binding.from);
  if (!step || step.type !== 'action') return undefined;
  const cap = resolveCapability(step.connector, step.action);
  return cap?.io?.outputs?.[binding.output] as ContractTypeName | undefined;
}

export function bindingsSatisfyInputs(
  step: Extract<Step, { type: 'action' }>,
  ir: WorkflowIR,
  guaranteedSources?: Set<string | 'trigger'>,
): boolean {
  const required = actionInputTypes(step.connector, step.action);
  if (required.length === 0) return true;

  for (const inputType of required) {
    const cap = resolveCapability(step.connector, step.action);
    const inputPort = Object.entries(cap?.io?.inputs ?? {}).find(([, type]) => type === inputType)?.[0];
    if (!inputPort) continue;
    if (hasConcreteParamForPort(step, inputPort)) continue;

    const binding = step.bindings?.[inputPort];
    if (!binding) return false;

    if (guaranteedSources && binding.from !== 'trigger' && !guaranteedSources.has(binding.from)) {
      return false;
    }

    const sourceType = bindingOutputType(binding, ir);
    if (!sourceType || !contractTypesCompatible(sourceType, inputType)) return false;
  }

  return true;
}

export function stepProducesOutputTypes(step: Step): ContractTypeName[] {
  if (step.type === 'action') return actionOutputTypes(step.connector, step.action);
  if (step.type === 'ai_decision') return ['JsonArtifact', 'TextArtifact'];
  return [];
}

export function triggerAvailableTypes(trigger: Trigger | undefined, inputs: string[]): ContractTypeName[] {
  const types = triggerOutputTypes(trigger?.type);
  if (trigger?.type === 'manual' && inputs.includes('filePath')) {
    const manualTypes: ContractTypeName[] = ['FileRef', 'DocumentIngestInput'];
    return [...new Set([...types, ...manualTypes])];
  }
  return types;
}

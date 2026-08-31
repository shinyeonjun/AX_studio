import { z } from 'zod';
import type { ContractTypeName } from '../contracts/capability-io.js';
import {
  PortBindingSchema,
  SNAPSHOT_BINDING_PREFIX,
  coercePortBinding,
  type PortBinding,
} from './port-binding.js';
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
import { linearContractSteps, stepsById } from './control-flow.js';
import type { Step, Trigger, WorkflowIR } from './schema.js';

export { PortBindingSchema, coercePortBinding, type PortBinding } from './port-binding.js';

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

export function aiDecisionOutputPorts(step: Extract<Step, { type: 'ai_decision' }>): AvailableOutput[] {
  const properties = step.outputSchema?.properties;
  const declared: AvailableOutput[] = (
    properties && typeof properties === 'object' && !Array.isArray(properties)
      ? Object.entries(properties as Record<string, unknown>)
      : []
  ).flatMap(([port, definition]): AvailableOutput[] => {
    const fieldType =
      definition && typeof definition === 'object' && !Array.isArray(definition)
        ? (definition as Record<string, unknown>).type
        : undefined;
    if (fieldType === 'string') {
      return [{ from: step.id, port, type: 'TextArtifact' as const }];
    }
    if (fieldType === 'number' || fieldType === 'integer' || fieldType === 'boolean' || fieldType === 'array') {
      return [{ from: step.id, port, type: 'JsonArtifact' as const }];
    }
    return [];
  });

  // `result` is the only generic AI output. Message text must use a declared
  // string field so the workflow contract names the value that will be sent.
  return [{ from: step.id, port: 'result', type: 'JsonArtifact' as const }, ...declared];
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

function isDeferredParamValue(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).ref === 'string' &&
      String((value as Record<string, unknown>).ref).trim(),
  );
}

export function paramValueForInputPort(
  step: Extract<Step, { type: 'action' }>,
  inputPort: string,
): unknown {
  if (inputPort === 'source') return step.params?.path ?? step.params?.file;
  if (inputPort === 'message') return step.params?.messageId ?? step.params?.message;
  return step.params?.[inputPort];
}

export function hasConcreteParamForPort(
  step: Extract<Step, { type: 'action' }>,
  inputPort: string,
): boolean {
  const value = paramValueForInputPort(step, inputPort);
  if (inputPort === 'source') {
    return isConcreteParamValue(value) || Boolean(step.params?.file) || isDeferredParamValue(value);
  }
  return isConcreteParamValue(value) || isDeferredParamValue(value);
}

function inferStepBindings(
  step: Step,
  available: AvailableOutput[],
  ir: WorkflowIR,
  guaranteedSources: Set<string | 'trigger'>,
): Step {
  if (step.type === 'ai_decision') {
    return inferAiDecisionBindings(step, available, guaranteedSources);
  }
  if (step.type !== 'action') return step;

  const cap = resolveCapability(step.connector, step.action);
  const inputPorts = cap?.io?.inputs ?? {};
  const bindings = { ...(step.bindings ?? {}) };

  for (const [inputPort, inputType] of Object.entries(inputPorts)) {
    // A folder event is the source of truth for the file being processed. This
    // also repairs workflows saved before document.ingest used FileRef params.
    if (ir.trigger?.type === 'local_folder.new_file' && inputPort === 'source') {
      const triggerSource = available.find(
        (candidate) =>
          candidate.from === 'trigger' &&
          contractTypesCompatible(candidate.type, inputType as ContractTypeName),
      );
      if (triggerSource) {
        bindings[inputPort] = { from: triggerSource.from, output: triggerSource.port };
        continue;
      }
    }

    if (bindings[inputPort] || hasConcreteParamForPort(step, inputPort)) continue;
    const source = findCompatibleSource(available, inputType as ContractTypeName);
    if (!source) continue;
    if (source.from !== 'trigger' && !guaranteedSources.has(source.from)) continue;
    bindings[inputPort] = { from: source.from, output: source.port };
  }

  return Object.keys(bindings).length > 0 ? { ...step, bindings } : step;
}

const AI_DECISION_DEFAULT_INPUTS: Record<string, ContractTypeName> = {
  document: 'DocumentArtifact',
  sourceText: 'TextArtifact',
  emailBody: 'TextArtifact',
  table: 'TableArtifact',
};

function inferAiDecisionInputContracts(
  step: Extract<Step, { type: 'ai_decision' }>,
  available: AvailableOutput[],
): Record<string, ContractTypeName> {
  if (step.inputContracts && Object.keys(step.inputContracts).length > 0) {
    return step.inputContracts;
  }
  const inferred: Record<string, ContractTypeName> = {};
  for (const [port, contract] of Object.entries(AI_DECISION_DEFAULT_INPUTS)) {
    if (findCompatibleSource(available, contract)) inferred[port] = contract;
  }
  return inferred;
}

function inferAiDecisionBindings(
  step: Extract<Step, { type: 'ai_decision' }>,
  available: AvailableOutput[],
  guaranteedSources: Set<string | 'trigger'>,
): Extract<Step, { type: 'ai_decision' }> {
  const inputContracts = inferAiDecisionInputContracts(step, available);
  if (Object.keys(inputContracts).length === 0) return step;

  const bindings = { ...(step.bindings ?? {}) };
  for (const [inputPort, inputType] of Object.entries(inputContracts)) {
    if (bindings[inputPort]) continue;
    const source = findCompatibleSource(available, inputType);
    if (!source) continue;
    if (source.from !== 'trigger' && !guaranteedSources.has(source.from)) continue;
    bindings[inputPort] = { from: source.from, output: source.port };
  }

  const next: Extract<Step, { type: 'ai_decision' }> = {
    ...step,
    inputContracts,
    ...(Object.keys(bindings).length > 0 ? { bindings } : {}),
  };
  return next;
}

function textFromBoundValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'body', 'summary']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return undefined;
}

export interface AiDecisionBoundContext {
  bound: Record<string, unknown>;
  documentText?: string;
  emailBody?: string;
  hasDocumentArtifact: boolean;
  usesExplicitBindings: boolean;
}

export function resolveAiDecisionBindings(
  step: Extract<Step, { type: 'ai_decision' }>,
  ir: WorkflowIR,
  stepResults: Record<string, unknown>,
  variables: Record<string, unknown>,
): AiDecisionBoundContext {
  const bindings = step.bindings ?? {};
  const inputContracts = step.inputContracts ?? {};
  const usesExplicitBindings = Object.keys(bindings).length > 0;
  const bound: Record<string, unknown> = {};
  let documentText: string | undefined;
  let emailBody: string | undefined;
  let hasDocumentArtifact = false;

  for (const [port, binding] of Object.entries(bindings)) {
    const value = resolveBindingValue(binding, ir, stepResults, variables);
    bound[port] = value;
    const contract = inputContracts[port];
    if (contract === 'DocumentArtifact') {
      hasDocumentArtifact = value != null;
      const text = textFromBoundValue(value);
      if (text) documentText = text;
    }
    if (contract === 'TextArtifact' || port === 'emailBody' || port === 'sourceText') {
      const text = textFromBoundValue(value);
      if (text) {
        if (port === 'emailBody') emailBody = text;
        else if (!documentText) documentText = text;
      }
    }
  }

  return { bound, documentText, emailBody, hasDocumentArtifact, usesExplicitBindings };
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
  const linear = linearContractSteps(ir.steps);
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
    const messageId = variables.messageId;
    return fileRefFromTriggerPayload(variables) ?? {
      id: typeof messageId === 'string' ? messageId : undefined,
      messageId,
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
  if (!step) return data;
  if (step.type === 'ai_decision') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const record = data as Record<string, unknown>;
    if (binding.output in record) return record[binding.output];
    if (binding.output === 'result') return record.result ?? record;
    return undefined;
  }
  if (step.type !== 'action') return data;
  return extractStepOutput(step, binding.output, data);
}

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
  if (!step) return undefined;
  if (step.type === 'ai_decision') {
    if (binding.output === 'result') return 'JsonArtifact';
    const properties = step.outputSchema?.properties;
    const definition =
      properties && typeof properties === 'object' && !Array.isArray(properties)
        ? (properties as Record<string, unknown>)[binding.output]
        : undefined;
    const type = definition && typeof definition === 'object' && !Array.isArray(definition)
      ? (definition as Record<string, unknown>).type
      : undefined;
    if (type === 'string') return 'TextArtifact';
    if (type === 'number' || type === 'integer' || type === 'boolean' || type === 'array') {
      return 'JsonArtifact';
    }
    return undefined;
  }
  if (step.type !== 'action') return undefined;
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
  if (step.type === 'ai_decision') return [...new Set(aiDecisionOutputPorts(step).map((port) => port.type))];
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

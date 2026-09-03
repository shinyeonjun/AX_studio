import type { ContractTypeName } from '../../contracts/capability-io.js';
import { contractTypesCompatible } from '../../contracts/compatibility.js';
import {
  actionInputTypes,
  actionOutputTypes,
  triggerCapabilityId,
  triggerOutputTypes,
} from '../../catalog/capability-contracts.js';
import { getCapability } from '../../catalog/capabilities.js';
import { resolveCapability } from '../../catalog/capability-graph.js';
import type { PortBinding } from '../port-binding.js';
import type { Step, Trigger, WorkflowIR } from '../schema.js';
import { aiDecisionOutputPorts, hasConcreteParamForPort } from './ports.js';

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
    return aiDecisionOutputPorts(step).find((output) => output.port === binding.output)?.type;
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

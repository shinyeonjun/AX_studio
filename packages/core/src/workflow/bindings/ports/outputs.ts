import type { ContractTypeName } from '../../../contracts/capability-io.js';
import { triggerCapabilityId } from '../../../catalog/capability-contracts.js';
import { getCapability } from '../../../catalog/capabilities.js';
import { resolveCapability } from '../../../catalog/capability-graph.js';
import type { Step, Trigger } from '../../schema.js';
import type { AvailableOutput } from './types.js';
import { decisionOutputProperties } from '../../ai-output-contract.js';
import { classifyDecisionOutput } from '../../../contracts/decision.js';

export function triggerOutputPorts(trigger: Trigger | undefined): AvailableOutput[] {
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

export function stepOutputPorts(step: Extract<Step, { type: 'action' }>): AvailableOutput[] {
  const cap = resolveCapability(step.connector, step.action);
  if (!cap?.io?.outputs) return [];
  return Object.entries(cap.io.outputs).map(([port, type]) => ({
    from: step.id,
    port,
    type: type as ContractTypeName,
  }));
}

export function aiDecisionOutputPorts(step: Extract<Step, { type: 'ai_decision' }>): AvailableOutput[] {
  return Object.entries(decisionOutputProperties(step)).flatMap(([port, definition]): AvailableOutput[] => {
    const route = classifyDecisionOutput(definition);
    if (route.kind === 'unsupported') return [];
    const text = route.kind === 'model'
      || (route.kind === 'constant' && typeof route.value === 'string')
      || (route.kind === 'choice' && route.options.every((value) => typeof value === 'string'));
    return [{
      from: step.id, port, type: text ? 'TextArtifact' : 'JsonArtifact',
      ...(route.kind === 'model' ? { purpose: 'prose' as const } : {}),
    }];
  });
}

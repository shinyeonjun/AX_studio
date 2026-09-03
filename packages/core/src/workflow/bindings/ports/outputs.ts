import type { ContractTypeName } from '../../../contracts/capability-io.js';
import { triggerCapabilityId } from '../../../catalog/capability-contracts.js';
import { getCapability } from '../../../catalog/capabilities.js';
import { resolveCapability } from '../../../catalog/capability-graph.js';
import type { Step, Trigger } from '../../schema.js';
import type { AvailableOutput } from './types.js';

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

  // `conclusion` is part of the default investigation output even when a
  // workflow does not declare a custom output schema. Keep an explicitly
  // declared field authoritative if a workflow overrides that name.
  const hasDeclaredConclusion = declared.some((output) => output.port === 'conclusion');
  return [
    { from: step.id, port: 'result', type: 'JsonArtifact' as const },
    ...(hasDeclaredConclusion ? [] : [{ from: step.id, port: 'conclusion', type: 'TextArtifact' as const }]),
    ...declared,
  ];
}

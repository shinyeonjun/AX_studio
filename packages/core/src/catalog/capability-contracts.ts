import { getCapability, CAPABILITY_CATALOG } from './capabilities.js';
import { resolveCapability } from './capability-graph.js';
import type { ContractTypeName } from '../contracts/capability-io.js';

const TRIGGER_CAPABILITY_BY_TYPE: Record<string, string> = Object.fromEntries(
  CAPABILITY_CATALOG.filter((cap) => cap.kind === 'trigger').map((cap) => [cap.id, cap.id]),
);

export function triggerCapabilityId(triggerType: string): string | undefined {
  return TRIGGER_CAPABILITY_BY_TYPE[triggerType];
}

export function triggerOutputTypes(triggerType: string | undefined): ContractTypeName[] {
  if (!triggerType || triggerType === 'manual' || triggerType === 'schedule' || triggerType === 'once') {
    return [];
  }
  const capId = triggerCapabilityId(triggerType);
  if (!capId) return [];
  const cap = getCapability(capId);
  if (!cap?.io?.outputs) return [];
  return [...new Set(Object.values(cap.io.outputs))];
}

export function actionCapabilityId(connector: string, action: string): string | undefined {
  return resolveCapability(connector, action)?.id ?? getCapability(`${connector}.${action}`)?.id;
}

export function actionInputTypes(connector: string, action: string): ContractTypeName[] {
  const capId = actionCapabilityId(connector, action);
  if (!capId) return [];
  const cap = getCapability(capId);
  if (!cap?.io?.inputs) return [];
  return [...new Set(Object.values(cap.io.inputs))];
}

export function actionOutputTypes(connector: string, action: string): ContractTypeName[] {
  const capId = actionCapabilityId(connector, action);
  if (!capId) return [];
  const cap = getCapability(capId);
  if (!cap?.io?.outputs) return [];
  return [...new Set(Object.values(cap.io.outputs))];
}

export function getCapabilityIo(capabilityId: string) {
  return getCapability(capabilityId)?.io;
}

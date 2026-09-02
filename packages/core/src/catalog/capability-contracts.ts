import { getCapability } from './capabilities.js';
import { resolveCapability } from './capability-resolver.js';
import type { ContractTypeName } from '../contracts/capability-io.js';

export function triggerCapabilityId(triggerType: string): string | undefined {
  const capability = getCapability(triggerType);
  return capability?.kind === 'trigger' ? capability.id : undefined;
}

export function triggerOutputTypes(triggerType: string | undefined): ContractTypeName[] {
  if (!triggerType || triggerType === 'manual' || triggerType === 'schedule' || triggerType === 'once') {
    return [];
  }
  const capId = triggerCapabilityId(triggerType);
  if (!capId) return [];
  const cap = getCapability(capId);
  if (!cap?.io?.outputs) return [];
  return [...new Set(Object.values(cap.io.outputs))] as ContractTypeName[];
}

export function actionCapabilityId(connector: string, action: string): string | undefined {
  return resolveCapability(connector, action)?.id ?? getCapability(`${connector}.${action}`)?.id;
}

export function actionInputTypes(connector: string, action: string): ContractTypeName[] {
  const capId = actionCapabilityId(connector, action);
  if (!capId) return [];
  const cap = getCapability(capId);
  if (!cap?.io?.inputs) return [];
  return [...new Set(Object.values(cap.io.inputs))] as ContractTypeName[];
}

export function actionOutputTypes(connector: string, action: string): ContractTypeName[] {
  const capId = actionCapabilityId(connector, action);
  if (!capId) return [];
  const cap = getCapability(capId);
  if (!cap?.io?.outputs) return [];
  return [...new Set(Object.values(cap.io.outputs))] as ContractTypeName[];
}

export function getCapabilityIo(capabilityId: string) {
  return getCapability(capabilityId)?.io;
}

import { mergeAvailableTypes } from '../../../contracts/compatibility.js';
import type { ContractTypeName } from '../../../contracts/capability-io.js';
import type { BindingSource } from '../types.js';

function addedTypes(base: ContractTypeName[], end: ContractTypeName[]): ContractTypeName[] {
  return end.filter((type) => !base.includes(type));
}

/** After IF, only types produced on every branch remain guaranteed. */
export function mergeBranchAvailability(
  base: ContractTypeName[],
  thenAvailable: ContractTypeName[],
  elseAvailable: ContractTypeName[],
): ContractTypeName[] {
  const thenAdded = addedTypes(base, thenAvailable);
  const elseAdded = addedTypes(base, elseAvailable);
  const shared = thenAdded.filter((type) => elseAdded.includes(type));
  return mergeAvailableTypes(base, shared);
}

export function mergeGuaranteedSources(
  base: Set<BindingSource>,
  thenSources: Set<BindingSource>,
  elseSources: Set<BindingSource>,
): Set<BindingSource> {
  const sharedBranchSteps = [...thenSources].filter(
    (source) => source !== 'trigger' && elseSources.has(source),
  );
  return new Set([...base, ...sharedBranchSteps]);
}

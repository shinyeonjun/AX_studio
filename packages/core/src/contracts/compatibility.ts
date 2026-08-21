import type { ContractTypeName } from './capability-io.js';

/** Output contract types that can satisfy a given input contract type. */
const COMPATIBLE_OUTPUTS: Record<ContractTypeName, ContractTypeName[]> = {
  FileRef: ['FileRef', 'DocumentIngestInput'],
  FileCreatedEvent: ['FileCreatedEvent', 'FileRef', 'DocumentIngestInput'],
  DocumentIngestInput: ['DocumentIngestInput', 'FileRef'],
  DocumentArtifact: ['DocumentArtifact'],
  TextArtifact: ['TextArtifact'],
  TableArtifact: ['TableArtifact'],
  JsonArtifact: ['JsonArtifact'],
  EmailMessageRef: ['EmailMessageRef'],
  SlackChannelRef: ['SlackChannelRef'],
  SlackMessageRef: ['SlackMessageRef'],
};

export function contractTypesCompatible(
  outputType: ContractTypeName,
  inputType: ContractTypeName,
): boolean {
  if (outputType === inputType) return true;
  return COMPATIBLE_OUTPUTS[outputType]?.includes(inputType) ?? false;
}

export function canSatisfyInput(
  availableOutputs: ContractTypeName[],
  inputType: ContractTypeName,
): boolean {
  return availableOutputs.some((output) => contractTypesCompatible(output, inputType));
}

export function mergeAvailableTypes(
  current: ContractTypeName[],
  produced: ContractTypeName[],
): ContractTypeName[] {
  return [...new Set([...current, ...produced])];
}

export function outputTypesFromCapabilityIo(
  io: { outputs: Record<string, ContractTypeName> } | undefined,
): ContractTypeName[] {
  if (!io?.outputs) return [];
  return [...new Set(Object.values(io.outputs))];
}

export function inputTypesFromCapabilityIo(
  io: { inputs: Record<string, ContractTypeName> } | undefined,
): ContractTypeName[] {
  if (!io?.inputs) return [];
  return [...new Set(Object.values(io.inputs))];
}

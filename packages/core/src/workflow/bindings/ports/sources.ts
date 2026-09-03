import { contractTypesCompatible } from '../../../contracts/compatibility.js';
import type { ContractTypeName } from '../../../contracts/capability-io.js';
import type { AvailableOutput } from './types.js';

export function findCompatibleSource(
  available: AvailableOutput[],
  inputType: ContractTypeName,
): AvailableOutput | undefined {
  for (let index = available.length - 1; index >= 0; index -= 1) {
    const candidate = available[index]!;
    if (contractTypesCompatible(candidate.type, inputType)) return candidate;
  }
  return undefined;
}

export function findPreferredTextSource(
  available: AvailableOutput[],
  inputType: ContractTypeName,
): AvailableOutput | undefined {
  if (inputType === 'TextArtifact') {
    const conclusion = [...available].reverse().find(
      (candidate) => candidate.port === 'conclusion' && contractTypesCompatible(candidate.type, inputType),
    );
    if (conclusion) return conclusion;
  }
  return findCompatibleSource(available, inputType);
}

export function findAiDecisionSource(
  available: AvailableOutput[],
  inputType: ContractTypeName,
): AvailableOutput | undefined {
  const candidate = findCompatibleSource(available, inputType);
  if (
    candidate?.from === 'trigger' &&
    candidate.port === 'path' &&
    inputType === 'TextArtifact'
  ) {
    // Webhook routes and bodies are both text artifacts. The route identifies
    // the workflow, while the body contains the provider data the AI is meant
    // to analyze. Keep the route available, but never mistake it for content.
    return available.find(
      (output) =>
        output.from === 'trigger' &&
        output.port === 'body' &&
        contractTypesCompatible(output.type, inputType),
    ) ?? candidate;
  }
  return candidate;
}

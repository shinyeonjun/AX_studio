import type { ContractTypeName } from '../../contracts/capability-io.js';
import type { Step } from '../schema.js';
import {
  aiDecisionOutputPorts,
  findAiDecisionSource,
  findCompatibleSource,
  type AvailableOutput,
} from './ports.js';

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

export function inferAiBindings(
  step: Extract<Step, { type: 'ai_decision' }>,
  available: AvailableOutput[],
  guaranteedSources: Set<string | 'trigger'>,
): Extract<Step, { type: 'ai_decision' }> {
  const inputContracts = inferAiDecisionInputContracts(step, available);
  if (Object.keys(inputContracts).length === 0) return step;

  const bindings = { ...(step.bindings ?? {}) };
  for (const [inputPort, inputType] of Object.entries(inputContracts)) {
    if (bindings[inputPort]) continue;
    const source = findAiDecisionSource(available, inputType);
    if (!source) continue;
    if (source.from !== 'trigger' && !guaranteedSources.has(source.from)) continue;
    bindings[inputPort] = { from: source.from, output: source.port };
  }

  return {
    ...step,
    inputContracts,
    ...(Object.keys(bindings).length > 0 ? { bindings } : {}),
  };
}

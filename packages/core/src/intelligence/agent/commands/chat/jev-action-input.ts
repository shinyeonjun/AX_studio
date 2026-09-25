import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import type { DecisionAnswer, DecisionQuestion } from '../../../../contracts/decision.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../decision/context.js';
import { jevActionInputQuestion } from './jev-decision-request.js';
import {
  jevActionQuotedInputMapping,
  type JevActionInputValue,
} from './jev-action-catalog.js';

export type JevActionInputSelection =
  | { kind: 'not_applicable' }
  | { kind: 'uncertain' }
  | { kind: 'mapped'; inputValue: JevActionInputValue };

export async function mapJevQuotedActionInput(input: {
  capability: ConnectorCapability;
  userMessage: string;
  inputValues?: readonly JevActionInputValue[];
  stepId: string;
  context?: unknown;
  evaluate: (
    state: unknown,
    questions: Record<string, DecisionQuestion>,
  ) => Promise<{ answers: Record<string, DecisionAnswer> }>;
}): Promise<JevActionInputSelection> {
  if (input.capability.kind !== 'write') return { kind: 'not_applicable' };
  const mapping = jevActionQuotedInputMapping(
    input.capability,
    input.userMessage,
    input.inputValues,
    input.stepId,
  );
  if (!mapping) return { kind: 'not_applicable' };
  if (mapping.kind === 'uncertain') return { kind: 'uncertain' };

  let selected = mapping.params.length === 1 ? mapping.params[0] : undefined;
  if (!selected) {
    const state = {
      request: boundDecisionString(input.userMessage),
      selected_action: {
        capability_id: input.capability.id,
        connector: input.capability.connector,
        label: boundDecisionString(input.capability.label, 120),
      },
      ...(input.context === undefined ? {} : { context: input.context }),
      policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
    };
    const questions = { action_input_0: jevActionInputQuestion(mapping.params) };
    const answer = (await input.evaluate(state, questions)).answers.action_input_0;
    if (!answer || answer.type !== 'choice') return { kind: 'uncertain' };
    const candidate = mapping.params.find((_, index) => answer.choice === `field_${index}`);
    if (!candidate) return { kind: 'uncertain' };
    selected = candidate;
  }

  return {
    kind: 'mapped',
    inputValue: {
      label: selected.label,
      value: mapping.value,
      stepId: input.stepId,
      capabilityId: input.capability.id,
      parameterName: selected.name,
    },
  };
}

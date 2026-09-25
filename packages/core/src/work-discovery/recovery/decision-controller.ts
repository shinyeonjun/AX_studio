import type { DecisionEngine, DecisionQuestion } from '../../contracts/decision.js';
import {
  boundDecisionString,
  DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
} from '../../intelligence/decision/context.js';
import type { DiscoveryRecoveryCheckpoint, DiscoverySessionState } from '../schema.js';

export type DiscoveryRecoveryAction =
  | 'retry_checkpoint'
  | 'expand_source_search'
  | 'ask_human'
  | 'stop';

export const DISCOVERY_RECOVERY_MAX_ATTEMPTS = 2;
export const DISCOVERY_RECOVERY_SOURCE_READ_CAP = 24;

export interface DiscoveryRecoveryDecisionInput {
  decisionEngine?: DecisionEngine;
  userGoal: string;
  checkpoint?: DiscoveryRecoveryCheckpoint;
  errorCode: string;
  errorMessage: string;
  autoRecoveryAttempts: number;
  budgets: DiscoverySessionState['budgets'];
  sourceInventory: DiscoverySessionState['sourceInventory'];
}

export interface DiscoveryRecoveryDecision {
  action: DiscoveryRecoveryAction;
  probability?: number;
  margin?: number;
  reason: 'decision_engine' | 'unclear' | 'invalid_answer' | 'unavailable' | 'attempt_limit' | 'budget_cap';
}

const ACTIONS: readonly DiscoveryRecoveryAction[] = [
  'retry_checkpoint',
  'expand_source_search',
  'ask_human',
  'stop',
];

function probabilitySummary(
  probabilities: Record<string, number>,
  selected: string,
): { probability: number; margin: number } | undefined {
  const values: Array<{ action: DiscoveryRecoveryAction; probability: number }> = [];
  for (const action of ACTIONS) {
    const probability = probabilities[action];
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      return undefined;
    }
    values.push({ action, probability });
  }
  const selectedEntry = values.find((entry) => entry.action === selected);
  if (!selectedEntry) return undefined;
  const second = values
    .filter((entry) => entry.action !== selected)
    .map((entry) => entry.probability)
    .sort((left, right) => right - left)[0] ?? 0;
  return {
    probability: selectedEntry.probability,
    margin: selectedEntry.probability - second,
  };
}

export async function decideDiscoveryRecovery(
  input: DiscoveryRecoveryDecisionInput,
): Promise<DiscoveryRecoveryDecision> {
  if (input.autoRecoveryAttempts >= DISCOVERY_RECOVERY_MAX_ATTEMPTS) {
    return { action: 'ask_human', reason: 'attempt_limit' };
  }
  if (!input.decisionEngine) {
    return { action: 'stop', reason: 'unavailable' };
  }

  const question: DecisionQuestion = {
    type: 'choice',
    instructions: {
      task: 'Choose the safest next recovery action for a failed work-discovery run.',
      rule: 'Do not bypass deterministic replay, validation, approval, or publish gates. Prefer human review when evidence is weak.',
      dataPolicy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
    },
    criteria: {
      retry_checkpoint: {
        meaning: 'Retry from the nearest recoverable checkpoint without increasing source-read budget.',
        bestWhen: 'The failure looks transient or occurred after useful snapshots/candidates were already produced.',
      },
      expand_source_search: {
        meaning: 'Restart discovery and allow a bounded increase in source reads so alternative sources can be explored.',
        bestWhen: 'Required output could not be reproduced and the relevant source may have been missed.',
      },
      ask_human: {
        meaning: 'Stop automatic recovery and surface needs_attention for a person to inspect or retry.',
        bestWhen: 'The cause is ambiguous, credentials/data may need intervention, or confidence is weak.',
      },
      stop: {
        meaning: 'Mark the discovery failed without another automatic attempt.',
        bestWhen: 'The failure is deterministic/non-recoverable or another attempt would only repeat the same work.',
      },
    },
  };

  try {
    const result = await input.decisionEngine.evaluate({
      state: {
        userGoal: boundDecisionString(input.userGoal),
        checkpoint: input.checkpoint ?? null,
        purpose: 'work_discovery_recovery',
        errorCode: boundDecisionString(input.errorCode, 256),
        errorMessage: boundDecisionString(input.errorMessage),
        autoRecoveryAttempts: input.autoRecoveryAttempts,
        budgets: input.budgets,
        sources: input.sourceInventory.slice(0, 12).map((source) => ({
          id: boundDecisionString(source.id, 256),
          label: boundDecisionString(source.label),
          connector: boundDecisionString(source.connector, 256),
          kind: source.kind,
          relevance: source.relevance,
        })),
      },
      questions: { recovery_action: question },
    });
    const answer = result.answers.recovery_action;
    if (!answer || answer.type !== 'choice' || !ACTIONS.includes(answer.choice as DiscoveryRecoveryAction)) {
      return { action: 'ask_human', reason: 'invalid_answer' };
    }

    const action = answer.choice as DiscoveryRecoveryAction;
    // Jev scores remain diagnostic only; the categorical choice drives the action.
    const summary = probabilitySummary(answer.probabilities, action);
    const telemetry = summary ? { probability: summary.probability, margin: summary.margin } : {};
    if (action === 'ask_human') return { action, ...telemetry, reason: 'unclear' };
    if (action === 'expand_source_search' && input.budgets.sourceReadsMax >= DISCOVERY_RECOVERY_SOURCE_READ_CAP) {
      return { action: 'ask_human', ...telemetry, reason: 'budget_cap' };
    }
    return { action, ...telemetry, reason: 'decision_engine' };
  } catch {
    return { action: 'stop', reason: 'unavailable' };
  }
}

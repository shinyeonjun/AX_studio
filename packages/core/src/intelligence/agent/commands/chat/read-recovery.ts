import type {
  ChoiceDecisionAnswer,
  DecisionEngine,
  DecisionQuestion,
} from '../../../../contracts/decision.js';
import {
  boundDecisionString,
  DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
} from '../../../decision/context.js';

export type ReadRecoveryRoute = 'parameterized' | 'http';
export type ReadRecoveryAction = 'repair' | 'ask_user' | 'stop';

export const READ_RECOVERY_MAX_REPAIRS = 1;
export const READ_RECOVERY_MIN_PROBABILITY = 0.8;
export const READ_RECOVERY_MIN_MARGIN = 0.15;

export interface ReadRecoveryDecisionInput {
  decisionEngine?: DecisionEngine;
  userMessage: string;
  route: ReadRecoveryRoute;
  status: string;
  errorCode: string;
  errorMessage: string;
  repairAttempts: number;
  signal?: AbortSignal;
}

export interface ReadRecoveryDecision {
  action: ReadRecoveryAction;
  probability?: number;
  margin?: number;
  reason: 'decision_engine' | 'low_confidence' | 'unavailable' | 'attempt_limit';
}

const ACTIONS: readonly ReadRecoveryAction[] = ['repair', 'ask_user', 'stop'];

function probabilitySummary(
  probabilities: Record<string, number>,
  selected: string,
): { probability: number; margin: number } | undefined {
  const values = ACTIONS.map((action) => ({
    action,
    probability: probabilities[action],
  }));
  if (values.some(({ probability }) =>
    typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1)) {
    return undefined;
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

function choiceAnswer(answer: unknown): ChoiceDecisionAnswer | undefined {
  return answer && typeof answer === 'object' && (answer as { type?: unknown }).type === 'choice'
    ? answer as ChoiceDecisionAnswer
    : undefined;
}

/**
 * Lets Jev choose whether a safe read failure has enough evidence for one
 * repair turn. The host still owns the attempt budget and command validation.
 */
export async function decideReadRecovery(
  input: ReadRecoveryDecisionInput,
): Promise<ReadRecoveryDecision> {
  input.signal?.throwIfAborted();
  if (input.repairAttempts >= READ_RECOVERY_MAX_REPAIRS) {
    return { action: 'ask_user', reason: 'attempt_limit' };
  }
  if (!input.decisionEngine) return { action: 'stop', reason: 'unavailable' };

  const question: DecisionQuestion = {
    type: 'choice',
    instructions: {
      task: 'Choose the safest next step after one failed read operation.',
      rule: 'Repair only when the host error gives actionable evidence and the next attempt remains the same read-only operation. Ask the user when a value, credential, permission, or target is missing. Stop when retrying would repeat a deterministic failure.',
      dataPolicy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
    },
    criteria: {
      repair: 'Use one new bounded command attempt based on the host error. Do not change the Jev-selected capability or connection, add secrets, or repeat the same invalid command unchanged.',
      ask_user: 'The user must clarify a missing/ambiguous value or intervene with credentials, permission, or connection state.',
      stop: 'The failure is deterministic, unsafe to retry, or there is not enough evidence for a useful repair.',
    },
  };

  try {
    const result = await input.decisionEngine.evaluate({
      state: {
        purpose: 'read_recovery',
        route: input.route,
        request: boundDecisionString(input.userMessage),
        failure: {
          status: boundDecisionString(input.status, 64),
          code: boundDecisionString(input.errorCode, 256),
          message: boundDecisionString(input.errorMessage, 512),
        },
        repairAttempts: input.repairAttempts,
      },
      questions: { recovery_action: question },
      signal: input.signal,
    });
    input.signal?.throwIfAborted();
    const answer = choiceAnswer(result.answers.recovery_action);
    if (!answer || !ACTIONS.includes(answer.choice as ReadRecoveryAction)) {
      return { action: 'ask_user', reason: 'low_confidence' };
    }
    const summary = probabilitySummary(answer.probabilities, answer.choice);
    if (!summary
      || summary.probability < READ_RECOVERY_MIN_PROBABILITY
      || summary.margin < READ_RECOVERY_MIN_MARGIN) {
      return {
        action: 'ask_user',
        reason: 'low_confidence',
        ...(summary ? { probability: summary.probability, margin: summary.margin } : {}),
      };
    }
    return {
      action: answer.choice as ReadRecoveryAction,
      probability: summary.probability,
      margin: summary.margin,
      reason: 'decision_engine',
    };
  } catch {
    input.signal?.throwIfAborted();
    return { action: 'stop', reason: 'unavailable' };
  }
}

/** Only failed read states can enter the recovery judge. Mutations never use it. */
export function isRecoverableReadStatus(status: string): boolean {
  return status === 'needs_input'
    || status === 'invalid'
    || status === 'not_found'
    || status === 'error';
}

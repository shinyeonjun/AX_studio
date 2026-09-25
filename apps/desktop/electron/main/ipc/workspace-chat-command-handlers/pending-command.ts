import type { AxCommand, AxInputRequest } from '@ax-studio/core';

const PENDING_COMMAND_TTL_MS = 24 * 60 * 60 * 1_000;

interface PendingPlan {
  token: string;
  goal: string;
  command: AxCommand;
  inputRequests: AxInputRequest[];
  state: 'ready' | 'running';
  expiresAt: number;
}

export type PendingCommandInputValue = {
  label: string;
  value: string;
  target?: 'trigger' | 'job';
  stepId?: string;
  capabilityId?: string;
  parameterName?: string;
};

export type PendingCommandClaim =
  | { kind: 'missing' | 'mismatch' | 'in_progress' }
  | { kind: 'claimed'; token: string; command: AxCommand; inputValues: PendingCommandInputValue[] };

// ponytail: keep one host-only continuation per chat; after restart/expiry, fail closed instead of re-planning a possibly different action.
const pendingBySession = new Map<string, PendingPlan>();
let nextToken = 0;

function goalOf(command: AxCommand, workflowUpdateGoal?: string): string | undefined {
  if (command.name === 'workflow.update') {
    return workflowUpdateGoal?.trim().slice(0, 2_000) || undefined;
  }
  if (!['execution.enqueue_once', 'workflow.create', 'job.propose'].includes(command.name)
    || typeof command.args.goal !== 'string') return undefined;
  return command.args.goal.trim().slice(0, 2_000);
}

function pruneExpired(now: number): void {
  for (const [sessionId, plan] of pendingBySession) {
    if (plan.state === 'ready' && plan.expiresAt <= now) pendingBySession.delete(sessionId);
  }
}

function save(sessionId: string, command: AxCommand, now: number, workflowUpdateGoal?: string): string | undefined {
  const goal = goalOf(command, workflowUpdateGoal);
  if (!sessionId || !goal) return undefined;
  const token = `${now}-${++nextToken}`;
  pendingBySession.set(sessionId, {
    token,
    goal,
    command: structuredClone(command),
    inputRequests: [],
    state: 'ready',
    expiresAt: now + PENDING_COMMAND_TTL_MS,
  });
  return token;
}

export function rememberPendingCommand(
  sessionId: string,
  command: AxCommand,
  now = Date.now(),
  workflowUpdateGoal?: string,
): string | undefined {
  pruneExpired(now);
  return save(sessionId, command, now, workflowUpdateGoal);
}

export function claimPendingCommand(
  sessionId: string,
  request: string,
  requestIds: readonly string[],
  submittedValues: readonly { requestId: string; value: string }[],
  now = Date.now(),
): PendingCommandClaim {
  pruneExpired(now);
  const plan = pendingBySession.get(sessionId);
  if (!plan) return { kind: 'missing' };
  if (plan.goal !== request.trim().slice(0, 2_000)) {
    return { kind: 'mismatch' };
  }
  const actualRequestIds = [...new Set(requestIds)].sort();
  const expectedRequestIds = plan.inputRequests.map(({ id }) => id).sort();
  if (expectedRequestIds.length === 0
    || expectedRequestIds.length !== actualRequestIds.length
    || expectedRequestIds.some((id, index) => id !== actualRequestIds[index])) {
    return { kind: 'mismatch' };
  }
  const requestById = new Map(plan.inputRequests.map((input) => [input.id, input]));
  const valuesById = new Map<string, PendingCommandInputValue>();
  for (const submitted of submittedValues) {
    const input = requestById.get(submitted.requestId);
    if (!input || valuesById.has(input.id) || submitted.value.length > 2_000
      || (input.options?.length && !input.options.some(({ value }) => value === submitted.value))) {
      return { kind: 'mismatch' };
    }
    valuesById.set(input.id, {
      label: input.label,
      value: submitted.value,
      ...(input.target ? { target: input.target } : {}),
      ...(input.stepId ? { stepId: input.stepId } : {}),
      ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
      ...(input.parameterName ? { parameterName: input.parameterName } : {}),
    });
  }
  if (plan.state === 'running') return { kind: 'in_progress' };
  if (plan.expiresAt <= now) {
    pendingBySession.delete(sessionId);
    return { kind: 'missing' };
  }
  plan.state = 'running';
  return {
    kind: 'claimed',
    token: plan.token,
    command: structuredClone(plan.command),
    inputValues: [...valuesById.values()],
  };
}

export function bindPendingCommandInputRequests(
  sessionId: string,
  token: string,
  inputRequests: readonly AxInputRequest[],
): void {
  const current = pendingBySession.get(sessionId);
  if (current?.token !== token || current.state !== 'ready') return;
  current.inputRequests = [...new Map(
    [...current.inputRequests, ...inputRequests].map((input) => [input.id, input]),
  ).values()];
}

export function replaceClaimedPendingCommand(
  sessionId: string,
  token: string,
  command: AxCommand,
  now = Date.now(),
  workflowUpdateGoal?: string,
): string | undefined {
  const current = pendingBySession.get(sessionId);
  if (current?.token !== token || current.state !== 'running' || !goalOf(command, workflowUpdateGoal)) return undefined;
  pendingBySession.delete(sessionId);
  return save(sessionId, command, now, workflowUpdateGoal);
}

export function finishClaimedPendingCommand(sessionId: string, token: string): void {
  const current = pendingBySession.get(sessionId);
  if (current?.token === token && current.state === 'running') pendingBySession.delete(sessionId);
}

export function clearPendingCommand(sessionId: string, includeRunning = false): void {
  const current = pendingBySession.get(sessionId);
  if (current && (includeRunning || current.state === 'ready')) pendingBySession.delete(sessionId);
}

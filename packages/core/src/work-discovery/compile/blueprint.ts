import { randomUUID } from 'node:crypto';
import type { CandidateProgram, DiscoveryBlueprint, DiscoverySessionState } from '../schema.js';
import type { OutputObservation } from '../observation/schema.js';
import type { TransformExpr } from '../../workflow/transform-expr/dsl.js';
import { buildOutputContract } from '../validation/output-contract.js';
import { filterSignature } from '../describe-expr.js';

export function sourceIdFromExpr(expr: TransformExpr): string | undefined {
  if (expr.op === 'source') return expr.sourceId;
  if ('input' in expr) return sourceIdFromExpr(expr.input);
  if (expr.op === 'ratio') {
    return sourceIdFromExpr(expr.numerator) ?? sourceIdFromExpr(expr.denominator);
  }
  return undefined;
}

export function partitionKey(candidate: CandidateProgram): string {
  const sourceId = sourceIdFromExpr(candidate.expr) ?? 'unknown';
  const aggregate = candidate.expr.op === 'aggregate'
    ? `${candidate.expr.fn}:${candidate.expr.column ?? '*'}`
    : candidate.expr.op === 'group'
      ? `group:${[candidate.expr.by, ...(candidate.expr.thenBy ?? []).map((entry) => entry.by)].join('+')}`
      : candidate.expr.op;
  // Rules that keep different rows are different rules, even with the same aggregate.
  const filter = filterSignature(candidate.expr);
  return `${candidate.observationPath}|${sourceId}|${aggregate}${filter ? `|${filter}` : ''}`;
}

function acceptedCandidates(candidates: CandidateProgram[]): CandidateProgram[] {
  return candidates.filter((candidate) => candidate.status === 'accepted');
}

export function requiredObservationPaths(observations: OutputObservation[]): string[] {
  const paths = new Set<string>();
  for (const observation of observations) {
    if (observation.required) paths.add(observation.path);
  }
  return [...paths];
}

export function replayGateSummary(session: DiscoverySessionState): DiscoveryBlueprint['replaySummary'] {
  const winners = acceptedCandidates(session.candidates);
  const total = session.candidates.length;
  const passed = winners.length;
  return {
    total,
    passed,
    failed: Math.max(0, total - passed),
  };
}

/** Distinct example documents that produced this session's observations. */
export function discoveryExampleCount(session: Pick<DiscoverySessionState, 'exampleIds' | 'observations'>): number {
  return new Set([
    ...session.exampleIds,
    ...session.observations.map((observation) => observation.exampleId),
  ]).size;
}

/**
 * A mapping replayed against a single example is a guess about the rule; publishing it
 * needs a second example or an explicit human confirmation.
 */
export const DISCOVERY_MIN_EXAMPLES_FOR_AUTO_PUBLISH = 2;

export function needsHumanConfirmation(
  session: Pick<DiscoverySessionState, 'exampleIds' | 'observations' | 'humanConfirmedAt'>,
): boolean {
  return !session.humanConfirmedAt && discoveryExampleCount(session) < DISCOVERY_MIN_EXAMPLES_FOR_AUTO_PUBLISH;
}

export function canPublish(session: DiscoverySessionState): { ok: true } | { ok: false; reason: string } {
  if (session.status !== 'ready_to_publish') {
    return { ok: false, reason: 'session_not_ready' };
  }
  if (session.pendingQuestion) {
    return { ok: false, reason: 'pending_clarification' };
  }
  if (needsHumanConfirmation(session)) {
    return { ok: false, reason: 'human_confirmation_required' };
  }
  const winners = acceptedCandidates(session.candidates);
  const requiredPaths = requiredObservationPaths(session.observations);
  if (requiredPaths.length === 0) {
    return { ok: false, reason: 'no_required_observations' };
  }
  for (const path of requiredPaths) {
    const forPath = winners.filter((candidate) => candidate.observationPath === path);
    if (forPath.length === 0) {
      return { ok: false, reason: 'missing_mapping' };
    }
    const unique = new Set(forPath.map(partitionKey));
    if (unique.size > 1) {
      return { ok: false, reason: 'ambiguous_mappings' };
    }
  }
  return { ok: true };
}

export function buildDiscoveryBlueprint(session: DiscoverySessionState): DiscoveryBlueprint | undefined {
  const winners = acceptedCandidates(session.candidates);
  const requiredPaths = requiredObservationPaths(session.observations);
  if (requiredPaths.length === 0 || winners.length === 0) return undefined;

  const fields = requiredPaths.map((path) => {
    const candidate = winners.find((entry) => entry.observationPath === path);
    const observation = session.observations.find((entry) => entry.path === path);
    return {
      outputPath: path,
      label: observation?.label,
      mapping: candidate?.expr,
      confidence: candidate?.score.replay ?? 0,
      status: candidate?.expr ? 'resolved' as const : 'unresolved' as const,
    };
  });

  if (fields.some((field) => !field.mapping)) return undefined;

  const replaySummary = replayGateSummary(session);
  return {
    id: `bp_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    sessionId: session.id,
    name: session.userGoal.slice(0, 80),
    goal: session.userGoal,
    triggerProposal: session.desiredRecurrence
      ? { type: 'schedule', schedule: session.desiredRecurrence, timezone: 'Asia/Seoul' }
      : { type: 'manual' },
    sources: session.sourceInventory.map((source) => ({
      id: source.id,
      connector: source.connector,
      metadata: source.metadata,
    })),
    fields,
    replaySummary,
    outputContract: buildOutputContract(session.observations),
    publishable: canPublish({ ...session, status: 'ready_to_publish', pendingQuestion: undefined }).ok,
  };
}

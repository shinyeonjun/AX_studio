import { randomUUID } from 'node:crypto';
import type { CandidateProgram, DiscoveryBlueprint, DiscoverySessionState } from '../schema.js';
import type { OutputObservation } from '../observation/schema.js';
import type { TransformExpr } from '../synthesis/transform-dsl.js';

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
    : candidate.expr.op === 'ratio'
      ? 'ratio'
      : candidate.expr.op;
  return `${candidate.observationPath}|${sourceId}|${aggregate}`;
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

export function canPublish(session: DiscoverySessionState): { ok: true } | { ok: false; reason: string } {
  if (session.status !== 'ready_to_publish') {
    return { ok: false, reason: 'session_not_ready' };
  }
  if (session.pendingQuestion) {
    return { ok: false, reason: 'pending_clarification' };
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
    publishable: canPublish({ ...session, status: 'ready_to_publish', pendingQuestion: undefined }).ok,
  };
}

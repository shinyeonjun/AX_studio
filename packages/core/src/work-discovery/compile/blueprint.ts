import { randomUUID } from 'node:crypto';
import type { TransformExpr } from '../synthesis/transform-dsl.js';
import type { CandidateProgram, DiscoveryBlueprint, DiscoverySessionState } from '../schema.js';

export function sourceIdFromExpr(expr: TransformExpr): string | undefined {
  if (expr.op === 'source') return expr.sourceId;
  if ('input' in expr) return sourceIdFromExpr(expr.input);
  if (expr.op === 'ratio') {
    return sourceIdFromExpr(expr.numerator) ?? sourceIdFromExpr(expr.denominator);
  }
  return undefined;
}

function acceptedCandidates(candidates: CandidateProgram[]): CandidateProgram[] {
  return candidates.filter((candidate) =>
    candidate.status === 'accepted' ||
    candidate.replayResults.some((entry) => entry.pass),
  );
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
  if (winners.length === 0) {
    return { ok: false, reason: 'replay_gate_failed' };
  }
  const paths = new Set(winners.map((candidate) => candidate.observationPath));
  if (paths.size !== winners.length) {
    return { ok: false, reason: 'ambiguous_mappings' };
  }
  return { ok: true };
}

export function buildDiscoveryBlueprint(session: DiscoverySessionState): DiscoveryBlueprint | undefined {
  const winners = acceptedCandidates(session.candidates);
  if (winners.length === 0) return undefined;

  const replaySummary = replayGateSummary(session);
  const fields = winners.map((candidate) => {
    const observation = session.observations.find((entry) => entry.path === candidate.observationPath);
    return {
      outputPath: candidate.observationPath,
      label: observation?.label,
      mapping: candidate.expr,
      confidence: candidate.score.replay,
      status: 'resolved' as const,
    };
  });

  return {
    id: `bp_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    sessionId: session.id,
    name: session.userGoal.slice(0, 80),
    goal: session.userGoal,
    triggerProposal: session.desiredRecurrence
      ? { type: 'schedule', schedule: session.desiredRecurrence, timezone: 'Asia/Seoul' }
      : { type: 'manual' },
    fields,
    replaySummary,
    publishable: replaySummary.failed === 0 && fields.every((field) => field.mapping),
  };
}

import { describe, expect, it } from 'vitest';
import { approvalSources, approvalTarget, canApprovalTransition, type ApprovalTransition } from './approval-state.js';

describe('approval lifecycle', () => {
  it.each<[ApprovalTransition, string[], string]>([
    ['claim', ['pending'], 'processing'],
    ['release', ['processing'], 'pending'],
    ['approve', ['pending', 'processing'], 'approved'],
    ['reject', ['pending', 'processing'], 'rejected'],
    ['reject_pending', ['pending'], 'rejected'],
    ['reopen', ['rejected'], 'pending'],
    ['fail', ['processing'], 'failed'],
  ])('%s starts from %j and ends in %s', (transition, sources, target) => {
    expect([...approvalSources(transition)]).toEqual(sources);
    expect(approvalTarget(transition)).toBe(target);
  });

  it('never resumes an approval that was already approved, rejected or failed', () => {
    for (const from of ['approved', 'rejected', 'failed'] as const) {
      expect(canApprovalTransition(from, 'claim')).toBe(false);
      expect(canApprovalTransition(from, 'approve')).toBe(false);
    }
  });

  it('claims a pending approval only once: a claimed one cannot be claimed again', () => {
    expect(canApprovalTransition('pending', 'claim')).toBe(true);
    expect(canApprovalTransition('processing', 'claim')).toBe(false);
  });
});

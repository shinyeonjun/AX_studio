/**
 * Approval lifecycle rules. Pure: no storage, no clock. Persistence asks this module which
 * states a transition may leave from, and writes the change only while the row is still in
 * one of them, so the rule is stated once and enforced atomically by the database.
 */

const APPROVAL_STATUSES = ['pending', 'processing', 'approved', 'rejected', 'failed'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type ApprovalTransition =
  /** A UI click reserves a pending approval before any provider is called. */
  | 'claim'
  /** Undo a claim that could not be persisted; no provider was called. */
  | 'release'
  /** The approved action finished, or it was approved and the run is closed. */
  | 'approve'
  /** Rejected by the run after it was claimed. */
  | 'reject'
  /** The user rejects a still-pending approval. */
  | 'reject_pending'
  /** Undo a rejection that could not be persisted. */
  | 'reopen'
  /** A claimed approval can no longer be resumed (failed send or restart). */
  | 'fail';

const SOURCES: Readonly<Record<ApprovalTransition, readonly ApprovalStatus[]>> = {
  claim: ['pending'],
  release: ['processing'],
  approve: ['pending', 'processing'],
  reject: ['pending', 'processing'],
  reject_pending: ['pending'],
  reopen: ['rejected'],
  fail: ['processing'],
};

const TARGETS: Readonly<Record<ApprovalTransition, ApprovalStatus>> = {
  claim: 'processing',
  release: 'pending',
  approve: 'approved',
  reject: 'rejected',
  reject_pending: 'rejected',
  reopen: 'pending',
  fail: 'failed',
};

/** States a transition may start from. Persistence writes WHERE status IN (these). */
export function approvalSources(transition: ApprovalTransition): readonly ApprovalStatus[] {
  return SOURCES[transition];
}

/** The state a transition leaves the approval in. */
export function approvalTarget(transition: ApprovalTransition): ApprovalStatus {
  return TARGETS[transition];
}

export function canApprovalTransition(from: ApprovalStatus, transition: ApprovalTransition): boolean {
  return SOURCES[transition].includes(from);
}

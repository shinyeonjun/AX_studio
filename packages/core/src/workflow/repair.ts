export {
  RepairCandidateOperationSchema,
  RepairReplayCaseSchema,
  RepairReplaySummarySchema,
  RepairProposalSchema,
} from './repair/contract.js';
export type {
  RepairCandidateOperation,
  RepairReplayCase,
  RepairReplaySummary,
  RepairProposal,
} from './repair/contract.js';
export { suggestRepairCandidates } from './repair/suggest.js';
export { applyRepairCandidate } from './repair/rewrite.js';
export {
  repairProtectedFingerprint,
  repairDedupeKey,
  emptyRepairReplaySummary,
} from './repair/protection.js';

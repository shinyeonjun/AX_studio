/**
 * What a host (the desktop app) keeps around chat turns, kept here so any host and core tests share
 * it: which confirmation a reply answers, the table on screen and how it was made, a command
 * waiting for input, and what one turn produced. The chat turn itself (../chat) never imports this.
 */
export {
  contextUpdateConfirmation,
  hasContextConfirmation,
  isJobConfirmation,
  mutationConfirmationToken,
  workflowIdsChanged,
} from './transcript-confirmations.js';
export {
  bindContextConfirmations,
  clearHostChatSession,
  clearHostChatStateForTests,
  CONTEXT_CONFIRMATION_PREFIX,
  consumeContextConfirmation,
  findContextConfirmationNonce,
  hostReadRecipeFor,
  hostReadResultFor,
  rememberHostReadResult,
} from './host-state.js';
export {
  bindPendingCommandInputRequests,
  claimPendingCommand,
  clearPendingCommand,
  finishClaimedPendingCommand,
  rememberPendingCommand,
  replaceClaimedPendingCommand,
  type PendingCommandInputValue,
} from './pending-command.js';
export { chatTurnCallbacks, emptyChatTurnState, type ChatTurnState, type PendingCommandClaim } from './turn-state.js';
export { readableConnections, selectJevReadOperations } from './read-operation-index.js';

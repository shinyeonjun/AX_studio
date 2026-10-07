import {
  runAxCommandChat,
  type TableArtifact,
  WorkspaceChatReadResultSchema,
} from '@ax-studio/core';
import type { AuthoritativeRequestAnchor, AxCommand, AxInputRequest, AxUiPresentation, ChatReadRecipe } from '@ax-studio/core';
import {
  bindPendingCommandInputRequests,
  finishClaimedPendingCommand,
  rememberPendingCommand,
  replaceClaimedPendingCommand,
  type PendingCommandInputValue,
} from './pending-command.js';
import { workflowIdsChanged } from './helpers.js';

export interface PendingCommandClaim {
  token: string;
  command: AxCommand;
  inputValues: PendingCommandInputValue[];
  request: string;
  requestDigest: string;
  requestAnchor?: AuthoritativeRequestAnchor;
}

/** What one command chat turn reports back to the renderer, filled in by the run callbacks. */
export interface ChatTurnState {
  changedWorkflowIds: Set<string>;
  removedWorkflowIds: Set<string>;
  inputRequests: AxInputRequest[];
  presentations: AxUiPresentation[];
  readResult?: TableArtifact;
  readResultReported: boolean;
  readRecipe?: ChatReadRecipe;
  pendingInputRequestToken?: string;
}

export function emptyChatTurnState(): ChatTurnState {
  return {
    changedWorkflowIds: new Set<string>(),
    removedWorkflowIds: new Set<string>(),
    inputRequests: [],
    presentations: [],
    readResultReported: false,
  };
}

/**
 * Callbacks for one runAxCommandChat call. A command that still needs input is remembered (or
 * replaces the claimed one) as a pending command, and its input requests are scoped to that token.
 */
export function chatTurnCallbacks(state: ChatTurnState, input: {
  sessionId: string;
  userMessage: string;
  claim?: PendingCommandClaim;
}) {
  const { sessionId, claim } = input;
  let acceptedRequestAnchor: AuthoritativeRequestAnchor | undefined;
  return {
    onRequestAnchor: (anchor) => { acceptedRequestAnchor = anchor; },
    onCommandResult: (result, command) => {
      const ids = workflowIdsChanged(result);
      if (ids.changed) state.changedWorkflowIds.add(ids.changed);
      if (ids.removed) state.removedWorkflowIds.add(ids.removed);
      if (!command || !['execution.enqueue_once', 'workflow.create', 'workflow.update', 'job.propose'].includes(command.name)
        || !result.inputRequests?.length) {
        if (claim) finishClaimedPendingCommand(sessionId, claim.token);
        return;
      }
      if (claim) {
        state.pendingInputRequestToken = replaceClaimedPendingCommand(
          sessionId,
          claim.token,
          command,
          Date.now(),
          claim.request,
          acceptedRequestAnchor,
        );
      } else {
        state.pendingInputRequestToken = rememberPendingCommand(
          sessionId,
          command,
          Date.now(),
          input.userMessage,
          acceptedRequestAnchor,
        );
      }
    },
    onInputRequests: (requests) => {
      const token = state.pendingInputRequestToken;
      state.inputRequests = token
        ? requests.map((request) => ({ ...request, id: `${request.id}-${token}` }))
        : requests;
      if (token) {
        bindPendingCommandInputRequests(
          sessionId,
          token,
          state.inputRequests,
        );
      }
    },
    onPresentation: (presentation) => {
      const token = state.pendingInputRequestToken;
      const scopedPresentation = token
        ? {
            ...presentation,
            inputs: presentation.inputs.map((request) => ({
              ...request,
              id: `${request.id}-${token}`,
            })),
          }
        : presentation;
      state.presentations.push(scopedPresentation);
      if (token) {
        bindPendingCommandInputRequests(
          sessionId,
          token,
          scopedPresentation.inputs,
        );
      }
    },
    onReadResult: (table) => {
      state.readResultReported = true;
      if (!table) {
        state.readResult = undefined;
        return;
      }
      const parsed = WorkspaceChatReadResultSchema.safeParse(table);
      state.readResult = parsed.success ? parsed.data : undefined;
    },
    onReadRecipe: (recipe) => {
      state.readRecipe = recipe;
    },
  } satisfies Partial<Parameters<typeof runAxCommandChat>[0]>;
}

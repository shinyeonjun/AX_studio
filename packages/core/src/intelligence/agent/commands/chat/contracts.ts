import type { AgentHarness } from '../../harness.js';
import type { ChatMessage } from '../../model/chat.js';
import type { AxCommandReadContext } from '../read-gateway.js';
import type { AxCommandService } from '../service.js';
import type { WorkspaceSourceRecord } from '../../../../persistence/workspace-source-service.js';
import type { AgentScopedContextMap } from '../../scoped-context.js';
import type { AxCommandResult, AxUiPresentation } from '../schema.js';
import { inputRequestsForResult } from '../input-requests.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import type { JevHttpEndpointHint } from './jev-router.js';
import type { JevReadOperationHint } from './jev-operation-catalog.js';

export interface AxCommandChatOptions {
  harness: AgentHarness;
  commandService: AxCommandService;
  /** Optional Jev route selector; command execution remains host-owned. */
  decisionEngine?: DecisionEngine;
  messages: ChatMessage[];
  userMessage: string;
  connectedConnectors?: string[];
  /** Safe HTTP endpoint ids/labels for Jev routing; never includes URLs or secrets. */
  httpEndpoints?: JevHttpEndpointHint[];
  /** Safe, read-only operation choices derived from persisted connector metadata. */
  readOperationHints?: JevReadOperationHint[];
  providerSessionId?: string;
  workspaceSessionId?: string;
  workspaceSources?: WorkspaceSourceRecord[];
  currentWorkflowId?: string;
  sessionMemo?: AgentScopedContextMap;
  workflowPolicy?: AgentScopedContextMap;
  /** Set only when the current user message is a host-rendered context confirmation. */
  allowContextUpdate?: boolean;
  /** Set only when the current user message is a host-rendered job confirmation. */
  allowJobCommit?: boolean;
  onProgress?: (event: { message: string }) => void;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  designToolContext?: AxCommandReadContext;
  designToolContextFactory?: () => AxCommandReadContext;
  onCommandResult?: (result: AxCommandResult) => void;
  onInputRequests?: (requests: ReturnType<typeof inputRequestsForResult>) => void;
  onPresentation?: (presentation: AxUiPresentation) => void;
}

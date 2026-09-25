import type { AgentHarness } from '../../harness.js';
import type { ChatMessage } from '../../model/chat.js';
import type { AxCommandReadContext } from '../read-gateway.js';
import type { AxCommandService } from '../service.js';
import type { WorkspaceSourceRecord } from '../../../../persistence/workspace-source-service.js';
import type { AgentScopedContextMap } from '../../scoped-context.js';
import type { AxCommand, AxCommandResult, AxContextUpdateConfirmation, AxUiPresentation } from '../schema.js';
import { inputRequestsForResult } from '../input-requests.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import type { JevWorkflowStepHint } from './jev-workflow-update.js';
import type { JevHttpEndpointHint } from './jev-http-endpoint.js';
import type {
  JevReadOperationHint,
  JevReadOperationSelection,
} from '../../../decision/read-operation-catalog.js';
import type { JevActionInputValue } from './jev-action-catalog.js';
import type { JevWorkflowOutputHint } from './jev-workflow-plan.js';
import type { TableArtifact } from '../../../../contracts/artifacts/table.js';

export interface AxCommandChatOptions {
  /** Chat may generate prose only; Jev owns route and command decisions. */
  harness: Pick<AgentHarness, 'providerName' | 'modelName' | 'runText'>;
  commandService: AxCommandService;
  /** Host-generated id used to correlate one desktop chat turn across logs. */
  requestId?: string;
  /** Optional Jev route selector; command execution remains host-owned. */
  decisionEngine?: DecisionEngine;
  messages: ChatMessage[];
  userMessage: string;
  /** Structured table shown in the immediately preceding assistant message. */
  previousReadResult?: TableArtifact;
  /** Original host-verified task while resuming typed command inputs. */
  decisionMessage?: string;
  /** Host-held command to resume without asking Jev to reconstruct its plan. */
  pendingCommand?: AxCommand;
  /** Typed values matched against the pending host input request; excluded from Jev context. */
  commandInputValues?: readonly JevActionInputValue[];
  connectedConnectors?: string[];
  /** Safe HTTP endpoint ids/labels for Jev routing; never includes URLs or secrets. */
  httpEndpoints?: JevHttpEndpointHint[];
  /** Safe, read-only operation choices derived from persisted connector metadata. */
  readOperationHints?: JevReadOperationHint[];
  /** Resolve the local read catalog only when this turn actually reaches Jev routing. */
  resolveReadOperationSelection?: () => JevReadOperationSelection;
  /** Total indexed read operations before the Jev choice budget is applied. */
  readOperationCatalogSize?: number;
  /** True when the index selected a bounded relevance slice. */
  readOperationCatalogMayBeBounded?: boolean;
  readOperationSelectionMode?: JevReadOperationSelection['mode'];
  readOperationLexicalMatchedOperationCount?: number;
  readOperationLexicalTopScore?: number;
  providerSessionId?: string;
  workspaceSessionId?: string;
  workspaceSources?: WorkspaceSourceRecord[];
  /** Resolve session PDF metadata only after Jev selects report generation. */
  resolveWorkspaceSources?: () => readonly WorkspaceSourceRecord[];
  currentWorkflowId?: string;
  /** Latest host-loaded definition version; used for optimistic workflow mutations. */
  currentWorkflowVersion?: number;
  /** Non-secret step summaries used only to let Jev identify an existing step. */
  currentWorkflowSteps?: JevWorkflowStepHint[];
  /** Typed output metadata only; never includes connector values or step parameters. */
  currentWorkflowOutputs?: JevWorkflowOutputHint[];
  sessionMemo?: AgentScopedContextMap;
  workflowPolicy?: AgentScopedContextMap;
  /** Exact proposal from the host-persisted confirmation card selected by the user. */
  contextUpdateConfirmation?: AxContextUpdateConfirmation;
  /** Set only when the current user message is a host-rendered job confirmation. */
  allowJobCommit?: boolean;
  /** Opaque token from the exact host-rendered job confirmation action. */
  jobCommitConfirmationToken?: string;
  onProgress?: (event: { message: string }) => void;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  designToolContext?: AxCommandReadContext;
  designToolContextFactory?: () => AxCommandReadContext;
  onCommandResult?: (result: AxCommandResult, command?: AxCommand) => void;
  onInputRequests?: (requests: ReturnType<typeof inputRequestsForResult>) => void;
  onPresentation?: (presentation: AxUiPresentation) => void;
  /** Persist only the table the host actually displayed, for a natural follow-up. */
  onReadResult?: (table: TableArtifact | undefined) => void;
}

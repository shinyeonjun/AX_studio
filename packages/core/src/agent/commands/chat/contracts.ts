import type { AgentHarness } from '../../harness.js';
import type { ChatMessage } from '../../model/chat.js';
import type { AxCommandReadContext } from '../read-gateway.js';
import type { AxCommandService } from '../service.js';
import type { WorkspaceSourceRecord } from '../../../store/workspace-source-service.js';
import type { AgentScopedContextMap } from '../../scoped-context.js';
import type { AxCommandResult, AxUiPresentation } from '../schema.js';
import { inputRequestsForResult } from '../input-requests.js';

export interface AxCommandChatOptions {
  harness: AgentHarness;
  commandService: AxCommandService;
  messages: ChatMessage[];
  userMessage: string;
  connectedConnectors?: string[];
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

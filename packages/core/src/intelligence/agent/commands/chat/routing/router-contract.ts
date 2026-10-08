import type { DecisionServiceFailure } from '../../../../decision/jev/errors.js';
import type { SourceChoice } from '../../../../../contracts/source-choices.js';
import type { AuthoritativeRequestAnchor, AuthoritativeRequestBudget, AuthoritativeRequestFailure } from '../../../../../contracts/request-anchor.js';
import type { AxUiPresentation } from '../../schema.js';
import type { DecisionEngine } from '../../../../../contracts/decision.js';
import type { AxCommand } from '../../schema.js';
import type { AgentScopedContextMap } from '../../../scoped-context.js';
import type { TableArtifact } from '../../../../../contracts/artifacts/table.js';
import type { WorkspaceSourceRecord } from '../../../../../persistence/workspace-source-service.js';
import type { JevReadOperationHint, JevReadOperationSelection } from '../../../../decision/read-operation-catalog.js';
import type { JevActionInputValue } from '../shared/action-catalog.js';
import type { JevWorkflowOutputHint } from '../planning/workflow-plan/index.js';
import type { JevWorkflowStepHint } from '../planning/workflow-update.js';
import type { JevHttpEndpointHint } from '../shared/http-endpoint.js';
import type { JevReadRecoveryContext } from './decision-request.js';
import type { JevChatRequestPlan, JevCommandPlan, JevConversationTurn } from '../shared/request-plan.js';
import type { JevChatRouteName } from './route-criteria.js';
import type { JevTableProjectionRequest, JevTableTransformRequest } from '../shaping/table-transform/index.js';

export interface JevChatRouterInput {
  decisionEngine: DecisionEngine;
  userMessage: string;
  /** Complete host-accepted intent, reused unchanged on typed input continuation. */
  requestAnchor?: AuthoritativeRequestAnchor;
  requestBudget?: Partial<AuthoritativeRequestBudget>;
  connectionRevision?: number;
  /** Bounded prior chat turns; the current message is supplied separately. */
  conversationHistory?: readonly JevConversationTurn[];
  currentWorkflowId?: string;
  currentWorkflowVersion?: number;
  currentWorkflowSteps?: readonly JevWorkflowStepHint[];
  currentWorkflowOutputs?: readonly JevWorkflowOutputHint[];
  sessionMemo?: AgentScopedContextMap;
  workflowPolicy?: AgentScopedContextMap;
  hasWorkspaceSession?: boolean;
  connectedConnectors?: readonly string[];
  /** Host-validated values from a pending command; never sent to Jev. */
  actionInputValues?: readonly JevActionInputValue[];
  /** Safe endpoint hints only; base URLs and credentials never enter Jev state. */
  httpEndpoints?: readonly JevHttpEndpointHint[];
  /** Safe local mappings from Jev choices to host-owned read commands. */
  readOperationHints?: readonly JevReadOperationHint[];
  readOperationCatalogSize?: number;
  readOperationCatalogMayBeBounded?: boolean;
  /** When set, the host index has already prepared the candidate list for Jev. */
  readOperationSelectionMode?: JevReadOperationSelection['mode'] | 'prepared_candidates';
  readOperationLexicalMatchedOperationCount?: number;
  readOperationLexicalTopScore?: number;
  /** Host-held visible table from the immediately preceding assistant reply. */
  previousReadResult?: TableArtifact;
  /** Where this person said similar requests should read from (picked in a source chooser). */
  pastSourceChoices?: readonly SourceChoice[];
  /** Restricts the decision to an alternative read or stopping after a read-only failure. */
  readRecoveryContext?: JevReadRecoveryContext;
  workspaceSources?: readonly WorkspaceSourceRecord[];
  resolveWorkspaceSources?: () => readonly WorkspaceSourceRecord[];
  abortSignal?: AbortSignal;
}

export interface JevChatRouterTelemetry {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  selectedRoute?: JevChatRouteName;
  routeConfidence?: number;
  selectedToolCount?: number;
  actionCandidateSelected?: boolean;
  questionIds: readonly string[];
  routeCandidateCount: number;
  operationCandidateCount: number;
  operationCatalogSize: number;
  operationCatalogMayBeBounded: boolean;
  actionCandidateCount: number;
  actionCatalogSize: number;
  actionCatalogMayBeBounded: boolean;
  operationSelectionMode?: JevReadOperationSelection['mode'] | 'prepared_candidates';
  operationLexicalMatchedOperationCount?: number;
  operationLexicalTopScore?: number;
  estimatedRequestBytes: number;
  evaluationCalls?: number;
  providerRequestCount?: number;
  planningCalls?: number;
  planningProviderRequestCount?: number;
  planningDurationMs?: number;
  planningStepCount?: number;
  planningCandidateCount?: number;
  planningCandidateCatalogMayBeBounded?: boolean;
  planningEstimatedRequestBytes?: number;
  planningInputTokens?: number;
  planningOutputTokens?: number;
  planningModels?: readonly string[];
}

export type JevChatRouterFallbackReason =
  | 'uncertain'
  | 'unsupported'
  | 'missing_context'
  | 'http_endpoint_required'
  | 'http_path_required'
  | 'service_error';

interface MissingReadParameters {
  capabilityId: string;
  requiredParameterPaths: readonly string[];
}

type JevChatRouterResultValue =
  | { kind: 'command'; command: AxCommand; route: JevChatRouteName; confidence: number; commandPlan?: JevCommandPlan; tableTransform?: JevTableTransformRequest; tableProjection?: JevTableProjectionRequest; readResultStyle?: 'summary' }
  | { kind: 'request_rejected'; failure: AuthoritativeRequestFailure }
  | { kind: 'previous_result'; route: 'previous_result'; confidence: number }
  | { kind: 'reply'; route: 'answer'; confidence: number }
  | { kind: 'clarify'; route: 'workflow_create' | 'workflow_update' | 'workflow_delete' | 'job_propose' | 'execution_enqueue_once' | 'context_remember' | 'report_generate'; message: string; confidence: number }
  | { kind: 'parameterized'; route: 'capability_read'; plan: MissingReadParameters; confidence: number }
  | {
      kind: 'fallback';
      reason: JevChatRouterFallbackReason;
      /** Which check fell back (for logs; never shown to people). */
      detail?: string;
      /** For service_error: busy, key rejected or unreachable, so the reply says what to do. */
      serviceFailure?: DecisionServiceFailure;
      evaluationCalls?: number;
      providerRequestCount?: number;
    };

export type JevChatRouterResult = JevChatRouterResultValue & {
  presentation?: AxUiPresentation;
  telemetry?: JevChatRouterTelemetry;
  requestPlan?: JevChatRequestPlan;
};

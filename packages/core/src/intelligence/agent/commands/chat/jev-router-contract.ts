import type { DecisionEngine } from '../../../../contracts/decision.js';
import type { AxCommand } from '../schema.js';
import type { AgentScopedContextMap } from '../../scoped-context.js';
import type { TableArtifact } from '../../../../contracts/artifacts/table.js';
import type { WorkspaceSourceRecord } from '../../../../persistence/workspace-source-service.js';
import type { JevReadOperationHint, JevReadOperationSelection } from '../../../decision/read-operation-catalog.js';
import type { JevActionInputValue } from './jev-action-catalog.js';
import type { JevWorkflowOutputHint } from './jev-workflow-plan.js';
import type { JevWorkflowStepHint } from './jev-workflow-update.js';
import type { JevHttpEndpointHint } from './jev-http-endpoint.js';
import type { JevReadRecoveryContext } from './jev-decision-request.js';
import type { JevChatRouteName } from './jev-route-criteria.js';
import type { JevTableProjectionRequest, JevTableTransformRequest } from './jev-table-transform.js';

export interface JevChatRouterInput {
  decisionEngine: DecisionEngine;
  userMessage: string;
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
  actionScopeChoice?: string;
  actionScopeConfidence?: number;
  actionCandidateSelected?: boolean;
  actionCandidateConfidence?: number;
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
  | { kind: 'command'; command: AxCommand; route: JevChatRouteName; confidence: number; tableTransform?: JevTableTransformRequest; tableProjection?: JevTableProjectionRequest; readResultStyle?: 'summary' }
  | { kind: 'previous_result'; route: 'previous_result'; confidence: number }
  | { kind: 'reply'; route: 'answer'; confidence: number }
  | { kind: 'clarify'; route: 'workflow_create' | 'workflow_update' | 'workflow_delete' | 'job_propose' | 'execution_enqueue_once' | 'context_remember' | 'report_generate'; message: string; confidence: number }
  | { kind: 'parameterized'; route: 'capability_read'; plan: MissingReadParameters; confidence: number }
  | {
      kind: 'fallback';
      reason: JevChatRouterFallbackReason;
      evaluationCalls?: number;
      providerRequestCount?: number;
    };

export type JevChatRouterResult = JevChatRouterResultValue & {
  telemetry?: JevChatRouterTelemetry;
};

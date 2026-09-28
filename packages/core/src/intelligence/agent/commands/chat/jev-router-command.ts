import type { ChoiceDecisionAnswer, DecisionAnswer } from '../../../../contracts/decision.js';
import { boundDecisionString } from '../../../decision/context.js';
import type { AxCommand } from '../schema.js';
import { deriveJevRequestFeatures, type JevRequestFeatures } from './request-features.js';
import {
  type JevReadOperationHint,
} from '../../../decision/read-operation-catalog.js';
import {
  explicitHttpPath,
  hasExplicitHttpEndpointCue,
  jevHttpEndpointChoices,
  selectHttpEndpointForRead,
} from './jev-http-endpoint.js';
import {
  JEV_TABLE_TRANSFORM_CRITERIA,
  type JevTableProjectionRequest,
  type JevTableTransformMode,
  type JevTableTransformRequest,
} from './jev-table-transform.js';
import type {
  JevWorkflowStepCandidate,
  JevWorkflowStepRemovalQuestionGroup,
} from './jev-workflow-update.js';
import type { JevChatRouteName } from './jev-route-criteria.js';
import type {
  JevChatRouterFallbackReason,
  JevChatRouterInput,
  JevChatRouterResult,
} from './jev-router-contract.js';
const ROUTE_QUERY_MAX_CHARS = 500;

export function fallback(reason: JevChatRouterFallbackReason): JevChatRouterResult {
  return { kind: 'fallback', reason };
}

export function choiceAnswer(answer: DecisionAnswer | undefined): ChoiceDecisionAnswer | undefined {
  return answer?.type === 'choice' ? answer : undefined;
}

export function resultLimit(
  answers: Record<string, DecisionAnswer>,
  requestFeatures: JevRequestFeatures,
): number {
  const choice = choiceAnswer(answers.result_limit)?.choice;
  const match = /^limit_(\d+)$/u.exec(choice ?? '');
  const value = match ? requestFeatures.result_limit_candidates?.[Number(match[1])] : undefined;
  return value && Number.isSafeInteger(value) && value > 0 ? value : 10;
}

export function tableTransformRequest(answer: DecisionAnswer | undefined): JevTableTransformRequest | undefined {
  const selected = choiceAnswer(answer);
  if (!selected) return 'uncertain';
  return Object.hasOwn(JEV_TABLE_TRANSFORM_CRITERIA, selected.choice)
    ? selected.choice as JevTableTransformMode | 'none'
    : 'uncertain';
}

export function tableProjectionRequest(answer: DecisionAnswer | undefined): JevTableProjectionRequest | undefined {
  const selected = choiceAnswer(answer);
  if (!selected) return undefined;
  return selected.choice === 'requested_columns' ? selected.choice : undefined;
}

export function httpReadCommand(
  input: JevChatRouterInput,
  answers: Record<string, DecisionAnswer>,
): AxCommand | JevChatRouterResult {
  const explicitMethod = deriveJevRequestFeatures(input.userMessage).explicit_http_method;
  if (explicitMethod && explicitMethod !== 'GET' && explicitMethod !== 'HEAD') {
    return fallback('unsupported');
  }
  const path = explicitHttpPath(input.userMessage);
  const endpoints = (input.httpEndpoints ?? []).filter((endpoint) => endpoint.usable !== false);
  if (endpoints.length === 0) return fallback('missing_context');

  const selectedByUser = selectHttpEndpointForRead(input.userMessage, endpoints);
  if (!selectedByUser && hasExplicitHttpEndpointCue(input.userMessage)) {
    return fallback('http_endpoint_required');
  }
  const endpointAnswer = choiceAnswer(answers.http_endpoint);
  const selectedChoice = endpointAnswer
    ? jevHttpEndpointChoices(endpoints).find(({ key }) => key === endpointAnswer.choice)
    : undefined;
  const selectedByJev = selectedChoice?.endpoint;
  const selected = selectedByUser ?? selectedByJev;
  if (!selected) return fallback('http_endpoint_required');
  if (!path) return fallback('http_path_required');

  return {
    name: 'capability.invoke',
    args: {
      id: 'http.request',
      params: {
        method: explicitMethod ?? 'GET',
        path,
        connectionId: selected.id,
      },
    },
  };
}

export function capabilityReadCommandForHint(
  hint: JevReadOperationHint,
  routeConfidence: number,
): AxCommand | JevChatRouterResult {
  const missingParameterPaths = hint.missingParameterPaths ?? [];
  if (missingParameterPaths.length > 0) {
    const allowedParameterPaths = (hint.parameterHints ?? []).map((parameter) => parameter.path);
    if (allowedParameterPaths.length === 0) return fallback('missing_context');
    return {
      kind: 'parameterized',
      route: 'capability_read',
      confidence: routeConfidence,
      plan: {
        capabilityId: hint.capabilityId,
        requiredParameterPaths: missingParameterPaths,
      },
    };
  }
  const params = { ...hint.params };
  if (hint.connector === 'http' && params.query && typeof params.query === 'object' && !Array.isArray(params.query)) {
    const query = params.query as Record<string, unknown>;
    const rawPath = typeof params.path === 'string' ? params.path : '';
    const [pathAndQuery, fragment] = rawPath.split('#', 2);
    const queryStart = pathAndQuery!.indexOf('?');
    const path = queryStart < 0 ? pathAndQuery! : pathAndQuery!.slice(0, queryStart);
    const search = new URLSearchParams(queryStart < 0 ? '' : pathAndQuery!.slice(queryStart + 1));
    for (const [name, value] of Object.entries(query)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        search.set(name, String(value));
      }
    }
    params.path = `${path}${search.size > 0 ? `?${search.toString()}` : ''}${fragment === undefined ? '' : `#${fragment}`}`;
    delete params.query;
  }
  return {
    name: 'capability.invoke',
    args: {
      id: hint.capabilityId,
      params,
    },
  };
}

export function selectedWorkflowStepFinalists(
  groups: readonly JevWorkflowStepRemovalQuestionGroup[],
  answers: Record<string, DecisionAnswer>,
): Array<{ candidate: JevWorkflowStepCandidate; answer: ChoiceDecisionAnswer }> | undefined {
  const finalists: Array<{ candidate: JevWorkflowStepCandidate; answer: ChoiceDecisionAnswer }> = [];
  for (const group of groups) {
    const answer = choiceAnswer(answers[group.questionId]);
    if (!answer) return undefined;
    if (answer.choice === 'none') continue;
    const candidate = group.candidates.find(({ index }) => `step_${index}` === answer.choice);
    if (!candidate) return undefined;
    finalists.push({ candidate, answer });
  }
  return finalists;
}

export function commandForRoute(
  route: JevChatRouteName,
  input: JevChatRouterInput,
  answers: Record<string, DecisionAnswer>,
  requestFeatures: JevRequestFeatures,
): AxCommand | JevChatRouterResult {
  const query = boundDecisionString(input.userMessage, ROUTE_QUERY_MAX_CHARS);
  const workflowId = input.currentWorkflowId?.trim();

  switch (route) {
    case 'resource_list':
      return { name: 'resource.list', args: {} };
    case 'connection_list':
      return { name: 'http.list', args: {} };
    case 'http_read':
      return httpReadCommand(input, answers);
    case 'capability_read':
      return fallback('unsupported');
    case 'source_list':
      return { name: 'source.list', args: {} };
    case 'session_source_list':
      return input.hasWorkspaceSession
        ? { name: 'session.source.list', args: {} }
        : fallback('missing_context');
    case 'source_search':
      return { name: 'source.search', args: { query, limit: resultLimit(answers, requestFeatures) } };
    case 'discovery_search':
      return { name: 'discovery.search', args: { query, limit: resultLimit(answers, requestFeatures) } };
    case 'workflow_list':
      return { name: 'workflow.list', args: {} };
    case 'workflow_inspect':
      return workflowId
        ? { name: 'workflow.inspect', args: { workflowId } }
        : fallback('missing_context');
    case 'workflow_validate':
      return workflowId
        ? { name: 'workflow.validate', args: { workflowId } }
        : fallback('missing_context');
    case 'workflow_run':
      return workflowId
        ? { name: 'workflow.run', args: { workflowId } }
        : fallback('missing_context');
    case 'report_generate':
      return fallback('unsupported');
    case 'answer':
      return fallback('unsupported');
    default:
      return fallback('unsupported');
  }
}

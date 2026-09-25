import {
  MAX_DECISION_CHOICE_CRITERIA,
  decisionProviderRequestCountFromError,
  type DecisionEngine,
  type DecisionEvaluationResult,
  type DecisionQuestion,
} from '../../../contracts/decision.js';
import type { ExecutionLogEntry } from '../../../connectors/types.js';
import type { OpenApiOperation, OpenApiParameter } from '../../../connectors/protocols/openapi/parse.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../intelligence/decision/context.js';
import { choiceAnswerConfidence } from '../../../intelligence/decision/confidence.js';
import { groupDecisionChoiceCandidates } from '../../../intelligence/decision/choice-grouping.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { MAX_REPORT_HTTP_PAGES, normalizeReportHttpPath, type ReportHttpSourceSpec } from '../source/schema.js';
import type { ReportHttpProbe, ReportHttpProbeCorrection, ReportJsonShape } from '../source/probe.js';
import { ReportSourceClarificationRequired } from './source-discovery.js';
import type { ReportHttpConnectionSummary } from './catalog.js';
import type { ReportCaptureInference } from './schema.js';

const PATH_ORIGIN = 'http://report-probe.invalid';

interface ShapePath {
  path: string;
  shape: ReportJsonShape;
}

interface Option<T> {
  id: string;
  value: T;
  evidence: Record<string, unknown>;
}

interface PendingChoice {
  id: string;
  alias: string;
  task: string;
  groups: Array<{ id: string; options: Map<string, { value: unknown; evidence: Record<string, unknown> }> }>;
}

interface SelectedChoiceOption {
  id: string;
  option: { value: unknown; evidence: Record<string, unknown> };
  confidence: number;
}

interface PagePlan {
  pageParam: string;
  sizeParam: string;
  pageSize: number;
  totalPagesPath: string;
  maxPages: number;
  startPage: 0 | 1;
  currentPagePath?: string;
}

interface PageCandidate {
  rowsPath: string;
  plan: PagePlan;
}

interface PreparedSource {
  source: ReportHttpSourceSpec;
  rowPath?: string;
  selectedDate?: { fromParam: string; toParam: string };
  selectedPagination?: PageCandidate;
  operation?: OpenApiOperation;
}

function clarification(message: string): never {
  throw new ReportSourceClarificationRequired(message);
}

function tokens(value: string): string[] {
  return value.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
}

function shapePaths(shape: ReportJsonShape): ShapePath[] {
  const result: ShapePath[] = [];
  const visit = (node: ReportJsonShape, segments: string[]) => {
    const path = segments.length ? segments.join('.') : '$';
    if (node.type === 'array' && node.item?.type === 'object'
      && Object.keys(node.item.fields).length > 0 && path.length <= 160) {
      result.push({ path, shape: node });
    }
    if (node.type === 'object') {
      for (const [key, child] of Object.entries(node.fields)) {
        if (!key || key === '$' || key.includes('.') || key.trim() !== key) continue;
        visit(child, [...segments, key]);
      }
    }
  };
  visit(shape, []);
  return result;
}

function metadataPaths(shape: ReportJsonShape): ShapePath[] {
  const result: ShapePath[] = [];
  const visit = (node: ReportJsonShape, segments: string[]) => {
    const path = segments.join('.');
    if (segments.length && path.length <= 160) result.push({ path, shape: node });
    if (node.type === 'object') {
      for (const [key, child] of Object.entries(node.fields)) {
        if (!key || key === '$' || key.includes('.') || key.trim() !== key) continue;
        visit(child, [...segments, key]);
      }
    }
  };
  visit(shape, []);
  return result;
}

function findShape(shape: ReportJsonShape, path: string): ReportJsonShape | undefined {
  if (path === '$') return shape;
  const segments = path.startsWith('$.') ? path.slice(2).split('.') : path.split('.');
  let current: ReportJsonShape | undefined = shape;
  for (const segment of segments) {
    if (!current || current.type !== 'object') return undefined;
    current = current.fields[segment];
  }
  return current;
}

function objectFields(shape: ReportJsonShape): Array<{ name: string; type: string }> {
  if (shape.type !== 'array' || shape.item?.type !== 'object') return [];
  return Object.entries(shape.item.fields).map(([name, field]) => ({ name, type: field.type }));
}

function operationFor(source: ReportHttpSourceSpec, connections: ReportHttpConnectionSummary[]): OpenApiOperation | undefined {
  if (!source.connectionId) return undefined;
  const pathname = new URL(normalizeReportHttpPath(source.path), PATH_ORIGIN).pathname;
  return connections.find(connection => connection.id === source.connectionId)?.operations?.find(operation =>
    operation.method === 'GET' && operation.path === pathname && operation.sideEffect === 'NONE');
}

function queryParameters(operation?: OpenApiOperation): OpenApiParameter[] {
  return [...new Map((operation?.parameters ?? []).filter(parameter => parameter.in === 'query')
    .map(parameter => [parameter.name, parameter])).values()];
}

function dateOptions(parameters: OpenApiParameter[]): Array<Option<{ fromParam: string; toParam: string }>> {
  const dateLike = (parameter: OpenApiParameter) => (parameter.type === undefined || parameter.type === 'string')
    && (parameter.format === undefined
      ? /\bdate\b/iu.test(`${parameter.name} ${parameter.description ?? ''}`)
      : parameter.format === 'date');
  const hasRole = (parameter: OpenApiParameter, role: 'from' | 'to') => {
    const words = new Set(tokens(`${parameter.name} ${parameter.description ?? ''}`));
    return role === 'from'
      ? ['from', 'start', 'since', 'begin'].some(word => words.has(word))
      : ['to', 'end', 'until', 'through'].some(word => words.has(word));
  };
  const starts = parameters.filter(parameter => dateLike(parameter) && hasRole(parameter, 'from'));
  const ends = parameters.filter(parameter => dateLike(parameter) && hasRole(parameter, 'to'));
  const options: Array<Option<{ fromParam: string; toParam: string }>> = [];
  for (const from of starts) for (const to of ends) {
    if (from.name === to.name) continue;
    if (/\bexclusive\b|not inclusive/iu.test(`${from.description ?? ''} ${to.description ?? ''}`)) continue;
    const value = { fromParam: from.name, toParam: to.name };
    options.push({ id: `date_${options.length}`, value, evidence: {
      from: parameterEvidence(from), to: parameterEvidence(to),
    } });
  }
  return options;
}

function parameterEvidence(parameter: OpenApiParameter): Record<string, unknown> {
  return { name: boundDecisionString(parameter.name, 160), ...(parameter.type ? { type: parameter.type } : {}),
    ...(parameter.format ? { format: parameter.format } : {}),
    ...(parameter.description ? { description: boundDecisionString(parameter.description, 300) } : {}) };
}

function pageRole(parameter: OpenApiParameter): boolean {
  return (parameter.type === undefined || parameter.type === 'integer' || parameter.type === 'number')
    && parameter.in === 'query' && ['page', 'p', 'page_number', 'page_index', 'page_no']
    .some(alias => tokens(parameter.name).join('_') === alias);
}

function sizeRole(parameter: OpenApiParameter): boolean {
  return (parameter.type === undefined || parameter.type === 'integer' || parameter.type === 'number')
    && parameter.in === 'query' && ['size', 'limit', 'per_page', 'page_size', 'page_limit']
    .some(alias => tokens(parameter.name).join('_') === alias);
}

function totalPagesPath(path: string): boolean {
  const parts = tokens(path);
  return [1, 2, 3].some(length => ['total_pages', 'total_page_count', 'page_count', 'last_page', 'number_of_pages']
    .includes(parts.slice(-length).join('_')));
}

function currentPagePaths(shape: ReportJsonShape, totalPath: string): string[] {
  const parent = totalPath.includes('.') ? totalPath.slice(0, totalPath.lastIndexOf('.')) : '';
  return metadataPaths(shape).filter(({ path, shape: candidate }) => {
    if (candidate.type !== 'number') return false;
    const name = tokens(path.slice(path.lastIndexOf('.') + 1)).join('_');
    const candidateParent = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '';
    return candidateParent === parent && ['page', 'current_page', 'page_number', 'page_index'].includes(name);
  }).map(candidate => candidate.path);
}

// A value-free probe cannot reveal page numbering; only an explicit API contract can.
function documentedStartPage(operation: OpenApiOperation): 0 | 1 | undefined {
  const text = [operation.summary, ...queryParameters(operation).map(parameter => parameter.description)]
    .filter(Boolean).join(' ').toLowerCase();
  const zero = /\b(?:zero|0)[ -]based\b|\bstarts?\s+(?:at|from)\s+0\b|\b0-indexed\b/u.test(text);
  const one = /\b(?:one|1)[ -]based\b|\bstarts?\s+(?:at|from)\s+1\b|\b1-indexed\b/u.test(text);
  return zero === one ? undefined : zero ? 0 : 1;
}

function pageOptions(
  shape: ReportJsonShape,
  rowsPath: string,
  operation?: OpenApiOperation,
): Array<Option<PagePlan>> {
  if (!operation) return [];
  const startPage = documentedStartPage(operation);
  const rows = findShape(shape, rowsPath);
  const observedPageSize = rows?.type === 'array' ? rows.length : 0;
  if (startPage === undefined || observedPageSize < 1) return [];
  const params = queryParameters(operation);
  const pages = params.filter(pageRole);
  const sizes = params.filter(sizeRole);
  const totals = metadataPaths(shape).filter(item => item.shape.type === 'number' && totalPagesPath(item.path));
  const options: Array<Option<PagePlan>> = [];
  for (const page of pages) for (const size of sizes) for (const total of totals) {
    if (page.name === size.name) continue;
    const currentPaths = currentPagePaths(shape, total.path);
    // Reuse the observed page length; capture still follows the API's total-page count and never truncates silently.
    const value: PagePlan = { pageParam: page.name, sizeParam: size.name,
      pageSize: observedPageSize, totalPagesPath: total.path,
      maxPages: MAX_REPORT_HTTP_PAGES, startPage,
      ...(currentPaths.length === 1 ? { currentPagePath: currentPaths[0] } : {}) };
    options.push({ id: `page_${options.length}`, value, evidence: {
      page: parameterEvidence(page), pageSize: parameterEvidence(size), totalPagesPath: total.path,
      ...(value.currentPagePath ? { currentPagePath: value.currentPagePath } : {}), startPage,
      observedRowsInProbe: observedPageSize,
    } });
  }
  return options;
}

function hasPaginationSignal(shape: ReportJsonShape): boolean {
  return metadataPaths(shape).some(({ path, shape: value }) => {
    const name = tokens(path).join('_');
    return value.type === 'number' && totalPagesPath(path)
      || ['has_more', 'has_next', 'has_next_page', 'next_page', 'next_cursor'].includes(name);
  });
}

function addChoice<T>(
  questionId: string,
  alias: string,
  task: string,
  options: Array<Option<T>>,
  questions: Record<string, DecisionQuestion>,
  pending: PendingChoice[],
): T | undefined {
  if (options.length === 0) return undefined;
  if (options.length === 1) return options[0]!.value;
  const optionGroups = groupDecisionChoiceCandidates(options, questionId,
    option => option.id, option => option.evidence, MAX_DECISION_CHOICE_CRITERIA);
  const groups: PendingChoice['groups'] = optionGroups.map(group => {
    const id = optionGroups.length === 1 ? questionId : group.questionId;
    const candidates = new Map(group.candidates.map(option => [option.id, {
      value: option.value,
      evidence: option.evidence,
    }]));
    const pendingGroup = { id, options: candidates };
    questions[id] = choiceQuestion(task, candidates);
    return pendingGroup;
  });
  pending.push({ id: questionId, alias, task, groups });
  return undefined;
}

function choiceQuestion(
  task: string,
  options: ReadonlyMap<string, { value: unknown; evidence: Record<string, unknown> }>,
): DecisionQuestion {
  return {
    type: 'choice',
    instructions: {
      task,
      selection: 'Choose only a listed option. If none is supported, omit the answer so the user can clarify.',
      policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
    },
    criteria: Object.fromEntries([...options].map(([id, option]) => [id, option.evidence])),
  };
}

function selectedOption(
  evaluation: DecisionEvaluationResult,
  pending: Pick<PendingChoice, 'task'>,
  group: PendingChoice['groups'][number],
): SelectedChoiceOption {
  const answer = evaluation.answers[group.id];
  if (!answer) {
    clarification(`API 응답의 ${pending.task} 후보를 판단하지 못했습니다. 조회 경로와 API 명세를 확인해 주세요.`);
  }
  if (answer.type !== 'choice' || !group.options.has(answer.choice)) {
    throw Object.assign(new Error('report_capture_refinement_jev_answer_invalid'), {
      code: 'report_capture_refinement_jev_answer_invalid',
    });
  }
  const confidence = choiceAnswerConfidence(answer, answer.choice);
  return { id: answer.choice, option: group.options.get(answer.choice)!, confidence };
}

async function resolveChoice(
  pending: PendingChoice,
  initialEvaluation: DecisionEvaluationResult,
  evaluate: (questions: Record<string, DecisionQuestion>) => Promise<DecisionEvaluationResult>,
): Promise<SelectedChoiceOption> {
  let finalists = pending.groups.map(group => selectedOption(initialEvaluation, pending, group));
  let round = 0;
  while (finalists.length > 1) {
    const questions: Record<string, DecisionQuestion> = {};
    const groups: PendingChoice['groups'] = [];
    const segments: Array<{ winner?: SelectedChoiceOption; group?: PendingChoice['groups'][number] }> = [];
    const finalistGroups = groupDecisionChoiceCandidates(finalists,
      `${pending.id}_tournament_${round}`, finalist => finalist.id,
      finalist => finalist.option.evidence, MAX_DECISION_CHOICE_CRITERIA);
    for (const finalistGroup of finalistGroups) {
      if (finalistGroup.candidates.length === 1) {
        segments.push({ winner: finalistGroup.candidates[0] });
        continue;
      }
      const id = finalistGroup.questionId;
      const options = new Map(finalistGroup.candidates.map(entry => [entry.id, entry.option]));
      const group = { id, options };
      groups.push(group);
      segments.push({ group });
      questions[id] = choiceQuestion(pending.task, options);
    }
    if (Object.keys(questions).length === 0) {
      clarification(`API 응답의 ${pending.task} 후보 정보를 안전한 Jev 요청 크기에서 비교할 수 없습니다. API 명세를 구체화해 주세요.`);
    }
    const evaluation = await evaluate(questions);
    finalists = segments.map(segment => segment.winner
      ?? selectedOption(evaluation, pending, segment.group!));
    round++;
  }
  return finalists[0]!;
}

function sourceProbe(source: ReportHttpSourceSpec, probes: ReportHttpProbe[]): ReportHttpProbe {
  const matches = probes.filter(probe => probe.alias === source.alias);
  if (matches.length !== 1) throw new Error(`report_http_probe_missing:${source.alias}`);
  const probe = matches[0]!;
  const expectedPath = new URL(normalizeReportHttpPath(source.path), PATH_ORIGIN).pathname;
  const actualPath = new URL(normalizeReportHttpPath(probe.path), PATH_ORIGIN).pathname;
  if (probe.status < 200 || probe.status >= 300 || expectedPath !== actualPath) {
    throw new Error(`report_http_probe_mismatch:${source.alias}`);
  }
  return probe;
}

function assertRequiredQueryParameters(
  source: ReportHttpSourceSpec,
  operation: OpenApiOperation | undefined,
  dateQuery?: { fromParam: string; toParam: string },
  pagination?: PagePlan,
): void {
  if (!operation) return;
  const configured = new Set<string>();
  const parsedPath = new URL(normalizeReportHttpPath(source.path), PATH_ORIGIN);
  for (const key of parsedPath.searchParams.keys()) configured.add(key);
  for (const key of Object.keys(source.staticQuery ?? {})) configured.add(key);
  for (const key of [dateQuery?.fromParam, dateQuery?.toParam, pagination?.pageParam, pagination?.sizeParam]) {
    if (key) configured.add(key);
  }
  const missing = queryParameters(operation).filter(parameter => parameter.required && !configured.has(parameter.name));
  if (missing.length) clarification(`API 경로 ${source.alias}에 필요한 조회 조건(${missing.map(item => item.name).join(', ')})을 확정할 수 없습니다. 해당 조건과 값을 알려 주세요.`);
}

function validateProbeCoverage(sources: ReportHttpSourceSpec[], probes: ReportHttpProbe[]): void {
  if (probes.length !== sources.length || new Set(probes.map(probe => probe.alias)).size !== probes.length) {
    throw new Error('report_http_probe_coverage_invalid');
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' });
}

function prepareSource(input: {
  source: ReportHttpSourceSpec;
  index: number;
  probe: ReportHttpProbe;
  operation?: OpenApiOperation;
  questions: Record<string, DecisionQuestion>;
  pending: PendingChoice[];
}): PreparedSource {
  const { source, index, probe, operation, questions, pending } = input;
  const rowOptions = shapePaths(probe.shape).map((candidate, optionIndex) => ({
    id: `rows_${optionIndex}`, value: candidate.path,
    evidence: { alias: source.alias, rowsPath: candidate.path, fields: objectFields(candidate.shape) },
  }));
  if (rowOptions.length === 0) clarification(`API 응답 ${source.alias}에서 보고서 행으로 사용할 객체 배열을 찾지 못했습니다.`);
  const validRowsPaths = new Set(rowOptions.map(option => option.value));
  const rowPath = validRowsPaths.has(source.rowsPath) ? source.rowsPath : addChoice<string>(`rows_${index}`, source.alias,
    'Choose the response array whose records best match the requested report data.', rowOptions, questions, pending);

  const dates = dateOptions(queryParameters(operation)).map(option => ({ ...option,
    evidence: { alias: source.alias, ...option.evidence } }));
  const selectedDate = addChoice<{ fromParam: string; toParam: string }>(`date_${index}`, source.alias,
    'Choose the documented query parameter pair for the report period.', dates, questions, pending);
  if (source.dateQuery && !dates.some(option => option.value.fromParam === source.dateQuery!.fromParam
    && option.value.toParam === source.dateQuery!.toParam)) {
    clarification(`API 명세에서 ${source.alias}의 기간 조회 조건을 확인할 수 없습니다. 사용해야 할 기간 파라미터를 확인해 주세요.`);
  }

  const paginationRowPaths = rowPath ? [rowPath] : rowOptions.map(option => option.value);
  const pages: Array<Option<PageCandidate>> = [];
  for (const candidatePath of paginationRowPaths) {
    for (const option of pageOptions(probe.shape, candidatePath, operation)) {
      pages.push({ ...option, id: `page_${pages.length}`,
        value: { rowsPath: candidatePath, plan: option.value },
        evidence: { alias: source.alias, ...option.evidence, rowsPath: candidatePath } });
    }
  }
  const selectedPagination = addChoice<PageCandidate>(`pagination_${index}`, source.alias,
    'Choose the documented page-number parameters and response field that represent the total page count.',
    pages, questions, pending);
  if ((source.pagination || hasPaginationSignal(probe.shape)) && pages.length === 0) {
    clarification(`API 응답 ${source.alias}에 페이지 정보가 있지만 현재는 페이지 번호 방식만 안전하게 재현할 수 있습니다. 시작 번호와 페이지·크기 파라미터가 명시되어 있는지 확인해 주세요. Cursor/offset 방식은 아직 지원하지 않습니다.`);
  }
  if (source.pagination && !pages.some(option => option.value.plan.pageParam === source.pagination!.pageParam
    && option.value.plan.sizeParam === source.pagination!.sizeParam
    && option.value.plan.totalPagesPath === source.pagination!.totalPagesPath
    && option.value.plan.startPage === (source.pagination!.startPage ?? 1))) {
    clarification(`API 명세에서 ${source.alias}의 페이지 조회 규칙을 검증할 수 없습니다.`);
  }
  return { source, rowPath, selectedDate, selectedPagination, operation };
}

export async function refineReportCapturePlan(input: {
  decisionEngine?: DecisionEngine;
  goal: string;
  pair: PdfReportPairAnalysis;
  provisional: ReportCaptureInference;
  httpProbes: ReportHttpProbe[];
  staticQueryCorrections?: ReportHttpProbeCorrection[];
  httpConnections: ReportHttpConnectionSummary[];
  signal?: AbortSignal;
  log?: (entry: ExecutionLogEntry) => void;
}): Promise<ReportCaptureInference> {
  const sources = input.provisional.capturePlan.http;
  validateProbeCoverage(sources, input.httpProbes);
  const questions: Record<string, DecisionQuestion> = {};
  const pending: PendingChoice[] = [];
  const plans = sources.map((source, index) => prepareSource({ source, index,
    probe: sourceProbe(source, input.httpProbes), operation: operationFor(source, input.httpConnections),
    questions, pending }));

  const selected = new Map<string, unknown>();
  const selectedChoices: Array<{ alias: string; decision: string; candidateId: string; confidence: number }> = [];
  let decisionStartedAt = 0;
  const evaluations: DecisionEvaluationResult[] = [];
  const providerRequestCount = () => evaluations.reduce(
    (total, result) => total + (result.providerRequestCount ?? 1), 0,
  );
  if (pending.length) {
    if (!input.decisionEngine) throw Object.assign(new Error('report_capture_refinement_jev_unavailable'), {
      code: 'report_capture_refinement_jev_unavailable',
    });
    decisionStartedAt = Date.now();
    const state = {
      request: boundDecisionString(input.goal),
      reportPeriods: { example: input.provisional.examplePeriod.label, target: input.provisional.targetPeriod.label },
      reportGeometry: { pageCount: input.pair.pageCount, scalarSlotCount: input.pair.scalarSlots.length,
        tableColumnCounts: input.pair.tableGroups.map(group => group.columnCount) },
      staticQueryCorrections: (input.staticQueryCorrections ?? []).map(correction => ({
        alias: boundDecisionString(correction.alias, 160), status: correction.status,
        queryKeys: correction.queryKeys.map(key => boundDecisionString(key, 160)),
      })),
      policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
    };
    const evaluate = async (candidateQuestions: Record<string, DecisionQuestion>) => {
      try {
        const result = await input.decisionEngine!.evaluate({
          state, questions: candidateQuestions, signal: input.signal,
        });
        throwIfAborted(input.signal);
        evaluations.push(result);
        return result;
      } catch (error) {
        const failedRequestCount = decisionProviderRequestCountFromError(error);
        input.log?.({ at: new Date().toISOString(), level: input.signal?.aborted ? 'info' : 'warn',
          code: input.signal?.aborted ? 'report_capture_refinement_jev_cancelled' : 'report_capture_refinement_jev_failed',
          message: input.signal?.aborted ? 'Jev HTTP capture refinement was cancelled.' : 'Jev HTTP capture refinement failed.',
          data: { durationMs: Date.now() - decisionStartedAt,
            ...(failedRequestCount === undefined ? {} : {
              providerRequestCount: providerRequestCount() + failedRequestCount,
            }),
            completedEvaluationCount: evaluations.length } });
        throwIfAborted(input.signal);
        throw Object.assign(new Error('report_capture_refinement_jev_failed'), {
          code: 'report_capture_refinement_jev_failed', cause: error,
        });
      }
    };

    let activeChoice: PendingChoice | undefined;
    try {
      const initialEvaluation = await evaluate(questions);
      for (const choice of pending) {
        activeChoice = choice;
        const winner = await resolveChoice(choice, initialEvaluation, evaluate);
        selected.set(choice.id, winner.option.value);
        selectedChoices.push({ alias: choice.alias, decision: choice.id,
          candidateId: winner.id, confidence: winner.confidence });
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (input.signal?.aborted || code === 'report_capture_refinement_jev_failed') throw error;
      const ambiguous = error instanceof ReportSourceClarificationRequired;
      const models = [...new Set(evaluations.map(result => result.model).filter((model): model is string => Boolean(model)))];
      const inputTokens = evaluations.reduce((total, result) => total + (result.usage?.inputTokens ?? 0), 0);
      const outputTokens = evaluations.reduce((total, result) => total + (result.usage?.outputTokens ?? 0), 0);
      input.log?.({ at: new Date().toISOString(), level: 'warn',
        code: ambiguous ? 'report_capture_refinement_jev_ambiguous' : 'report_capture_refinement_jev_answer_invalid',
        message: ambiguous ? 'Jev could not select an HTTP capture option; user clarification is required.' : 'Jev returned an invalid HTTP capture choice.',
        data: { decisionCount: pending.length, providerRequestCount: providerRequestCount(),
          ...(activeChoice ? { alias: activeChoice.alias, decision: activeChoice.id } : {}),
          ...(models.length ? { model: models.join(',') } : {}),
          ...(inputTokens ? { inputTokens } : {}), ...(outputTokens ? { outputTokens } : {}) } });
      throw error;
    }

    const models = [...new Set(evaluations.map(result => result.model).filter((model): model is string => Boolean(model)))];
    const inputTokens = evaluations.reduce((total, result) => total + (result.usage?.inputTokens ?? 0), 0);
    const outputTokens = evaluations.reduce((total, result) => total + (result.usage?.outputTokens ?? 0), 0);
    input.log?.({ at: new Date().toISOString(), level: 'info', code: 'report_capture_refinement_jev_completed',
      message: 'Jev selected among host-validated HTTP response and query candidates.',
      data: { durationMs: Date.now() - decisionStartedAt,
        candidateCount: pending.reduce((count, item) => count
          + item.groups.reduce((groupCount, group) => groupCount + group.options.size, 0), 0),
        decisionCount: pending.length, evaluationCount: evaluations.length,
        selectedChoices, providerRequestCount: providerRequestCount(),
        ...(models.length ? { model: models.join(',') } : {}),
        ...(inputTokens ? { inputTokens } : {}), ...(outputTokens ? { outputTokens } : {}) } });
  }
  throwIfAborted(input.signal);
  plans.forEach(({ source, selectedDate, selectedPagination, operation }, index) => {
    assertRequiredQueryParameters(source, operation,
      selected.get(`date_${index}`) as { fromParam: string; toParam: string } | undefined ?? selectedDate,
      (selected.get(`pagination_${index}`) as PageCandidate | undefined ?? selectedPagination)?.plan);
  });
  return {
    ...input.provisional,
    capturePlan: {
      ...input.provisional.capturePlan,
      http: plans.map(({ source, rowPath, selectedDate, selectedPagination }, index) => {
        const chosenRowsPath = selected.get(`rows_${index}`) as string | undefined;
        const chosenDate = selected.get(`date_${index}`) as { fromParam: string; toParam: string } | undefined;
        const chosenPagination = selected.get(`pagination_${index}`) as PageCandidate | undefined;
        const resolvedRowsPath = chosenRowsPath ?? rowPath ?? source.rowsPath;
        if (chosenPagination && chosenPagination.rowsPath !== resolvedRowsPath) {
          clarification(`API 응답 ${source.alias}에서 행 목록과 페이지 메타데이터가 서로 다른 구조를 가리킵니다. 사용할 경로를 확인해 주세요.`);
        }
        const { dateQuery: _dateQuery, pagination: _pagination, ...base } = source;
        return { ...base, rowsPath: resolvedRowsPath,
          ...((chosenDate ?? selectedDate) ? { dateQuery: chosenDate ?? selectedDate } : {}),
          ...((chosenPagination?.plan ?? selectedPagination?.plan)
            ? { pagination: chosenPagination?.plan ?? selectedPagination?.plan } : {}) };
      }),
    },
  };
}

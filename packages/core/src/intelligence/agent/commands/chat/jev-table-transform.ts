import type {
  DecisionAnswer,
  DecisionEvaluationResult,
  DecisionEngine,
  DecisionInstruction,
  DecisionQuestion,
} from '../../../../contracts/decision.js';
import { decisionProviderRequestCountFromError } from '../../../../contracts/decision.js';
import { profileTable } from '../../../../contracts/artifacts/table-build.js';
import { TableArtifactSchema, type TableArtifact } from '../../../../contracts/artifacts/table.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../decision/context.js';
import { groupJevChoiceCandidates } from './jev-choice-grouping.js';
import { evaluateTransformExpr } from '../../../../workflow/transform-expr/evaluator.js';
import { TransformExprSchema, type TransformExpr } from '../../../../workflow/transform-expr/dsl.js';

const SOURCE_ID = 'chat:read-result';
export const JEV_TABLE_TRANSFORM_CRITERIA = {
  none: 'Return the retrieved data without filtering or sorting.',
  filter: 'Keep only rows matching one clearly specified filter condition.',
  sort: 'Reorder rows by one clearly specified column and direction.',
  filter_sort: 'Apply one clearly specified filter condition, then sort by one clearly specified column and direction.',
} satisfies Record<string, DecisionInstruction>;
const FILTER_COLUMN_INSTRUCTIONS: DecisionInstruction = {
  question: 'Which result column is constrained by the requested comparison?',
  focus: 'Choose only a schema column explicitly supported by the user request. If none fits, choose none.',
};
const SORT_COLUMN_INSTRUCTIONS: DecisionInstruction = {
  question: 'Which result column should determine row order?',
  focus: 'Choose only a schema column supported by the request; choose none if the sort key is unclear.',
};
export type JevTableTransformMode = Exclude<keyof typeof JEV_TABLE_TRANSFORM_CRITERIA, 'none'>;
export type JevTableTransformRequest = JevTableTransformMode | 'none' | 'uncertain' | 'auto';
export const JEV_TABLE_PROJECTION_CRITERIA = {
  all_columns: 'Show the complete result schema; no explicit subset was requested.',
  requested_columns: 'Show only the result fields explicitly named or clearly requested by the user.',
} satisfies Record<string, DecisionInstruction>;
export type JevTableProjectionRequest = 'requested_columns';
const DISPLAY_COLUMN_TASK = 'Select only fields explicitly named or clearly requested by meaning. Exclude unrelated fields; use unclear only for genuine ambiguity.';
type ComparisonOperator = 'gt' | 'gte' | 'lt' | 'lte';

export type JevTableTransformResult =
  | { status: 'transformed'; table: TableArtifact; model?: string; providerRequestCount?: number; usage?: { inputTokens?: number; outputTokens?: number } }
  | { status: 'clarify'; message: string; model?: string; providerRequestCount?: number; usage?: { inputTokens?: number; outputTokens?: number } }
  | { status: 'not_applicable'; model?: string; providerRequestCount?: number; usage?: { inputTokens?: number; outputTokens?: number } }
  | { status: 'unavailable'; providerRequestCount?: number };

function columnLabel(column: TableColumn): string {
  return boundDecisionString(column.label?.trim() || column.name, 160);
}

type TableColumn = TableArtifact['columns'][number];
type ColumnCandidate = { key: string; column: TableColumn };
type ColumnChoiceGroup = {
  questionId: string;
  candidates: readonly ColumnCandidate[];
  criteria: Record<string, DecisionInstruction>;
};

function columnChoiceGroups(
  columns: readonly TableColumn[],
  questionPrefix: string,
  singleGroupUsesPrefix = true,
): ColumnChoiceGroup[] {
  // Option IDs are host-owned so schema names cannot collide with reserved choices like `none`.
  const candidates = columns.map((column, index) => ({ key: `column_${index}`, column }));
  const groups = groupJevChoiceCandidates(
    candidates,
    questionPrefix,
    (candidate) => candidate.key,
    ({ column }) => ({ label: columnLabel(column), field: boundDecisionString(column.name, 160), type: column.type }),
  );
  if (groups.length === 0) {
    return [{ questionId: questionPrefix, candidates: [], criteria: { none: 'No schema column is available.' } }];
  }
  return groups.map(({ questionId, candidates, criteria }) => ({
    questionId: singleGroupUsesPrefix && groups.length === 1 ? questionPrefix : questionId,
    candidates,
    criteria: { none: 'No available column matches the requested operation.', ...criteria },
  }));
}

function selectedColumnFinalists(
  groups: readonly ColumnChoiceGroup[],
  answers: Record<string, DecisionAnswer>,
): TableColumn[] | undefined {
  const finalists: TableColumn[] = [];
  for (const group of groups) {
    const choice = selectedChoice(answers[group.questionId], new Set(Object.keys(group.criteria)));
    if (!choice) return undefined;
    if (choice === 'none') continue;
    const candidate = group.candidates.find(({ key }) => key === choice);
    if (!candidate) return undefined;
    finalists.push(candidate.column);
  }
  return finalists;
}

type JevEvaluationMetadata = {
  providerRequestCount: number;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

function accumulateEvaluationMetadata(
  metadata: JevEvaluationMetadata,
  evaluation: DecisionEvaluationResult,
): void {
  metadata.providerRequestCount += evaluation.providerRequestCount ?? 1;
  if (evaluation.model) metadata.model = evaluation.model;
  if (evaluation.usage) {
    const sum = (previous: number | undefined, current: number | undefined) =>
      previous === undefined && current === undefined ? undefined : (previous ?? 0) + (current ?? 0);
    const inputTokens = sum(metadata.usage?.inputTokens, evaluation.usage.inputTokens);
    const outputTokens = sum(metadata.usage?.outputTokens, evaluation.usage.outputTokens);
    metadata.usage = {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    };
  }
}

type ColumnSelection = {
  field: 'filter_column' | 'sort_column';
  groups: ColumnChoiceGroup[];
  instructions: DecisionInstruction;
};

async function resolveColumnSelections(input: {
  decisionEngine: DecisionEngine;
  request: string;
  selections: ColumnSelection[];
  answers: Record<string, DecisionAnswer>;
  abortSignal?: AbortSignal;
  metadata: JevEvaluationMetadata;
}): Promise<Partial<Record<'filter_column' | 'sort_column', string>> | undefined> {
  const pending = input.selections.map((selection) => ({
    ...selection,
    finalists: selectedColumnFinalists(selection.groups, input.answers),
  }));
  if (pending.some(({ finalists }) => finalists === undefined || finalists.length === 0)) return undefined;

  let round = 0;
  while (pending.some(({ finalists }) => finalists!.length > 1)) {
    const groupsByField = new Map<'filter_column' | 'sort_column', ColumnChoiceGroup[]>();
    const questions: Record<string, DecisionQuestion> = {};
    for (const selection of pending) {
      if (selection.finalists!.length < 2) continue;
      const groups = columnChoiceGroups(selection.finalists!, `${selection.field}_tournament_${round}`, false);
      groupsByField.set(selection.field, groups);
      for (const group of groups) {
        questions[group.questionId] = {
          type: 'choice',
          instructions: selection.instructions,
          criteria: group.criteria,
        };
      }
    }
    input.abortSignal?.throwIfAborted();
    const evaluation = await input.decisionEngine.evaluate({
      state: { request: input.request, policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY },
      questions,
      signal: input.abortSignal,
    });
    input.abortSignal?.throwIfAborted();
    accumulateEvaluationMetadata(input.metadata, evaluation);
    for (const selection of pending) {
      const groups = groupsByField.get(selection.field);
      if (!groups) continue;
      const finalists = selectedColumnFinalists(groups, evaluation.answers);
      if (!finalists?.length) return undefined;
      selection.finalists = finalists;
    }
    round += 1;
  }

  return Object.fromEntries(pending.map(({ field, finalists }) => [field, finalists![0]!.name]));
}

function numericValues(message: string): number[] {
  const values = new Set<number>();
  for (const match of message.matchAll(/-?\d[\d,]*(?:\.\d+)?/gu)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(value)) values.add(value);
  }
  return [...values];
}

function valueCriteria(values: readonly number[]): Record<string, DecisionInstruction> {
  return Object.fromEntries([
    ['none', 'No explicit numeric value in the user request matches the filter threshold.'],
    ...values.map((value, index) => [`value_${index}`, {
      value,
    }]),
  ]);
}

function selectedChoice(answer: DecisionAnswer | undefined, allowed: ReadonlySet<string>): string | undefined {
  // The host owns candidate validity; confidence is telemetry, not a veto.
  return answer?.type === 'choice' && allowed.has(answer.choice) ? answer.choice : undefined;
}

function selectedValue(choice: string, values: readonly number[]): number | undefined {
  const match = /^value_(\d+)$/u.exec(choice);
  return match ? values[Number(match[1])] : undefined;
}

function displayColumnQuestions(columns: readonly TableColumn[]): Record<string, DecisionQuestion> {
  return Object.fromEntries(columns.map((column, index) => [`display_column_${index}`, {
    type: 'choice' as const,
    instructions: `Should "${columnLabel(column)}" (field "${boundDecisionString(column.name, 160)}", type ${column.type}) be shown?`,
    criteria: {
      include: 'Include',
      exclude: 'Exclude',
      unclear: 'Unclear',
    },
  }]));
}

function selectedDisplayColumns(
  columns: readonly TableColumn[],
  answers: Record<string, DecisionAnswer>,
): string[] | undefined {
  const selected: string[] = [];
  for (const [index, column] of columns.entries()) {
    const answer = answers[`display_column_${index}`];
    if (answer?.type !== 'choice') return undefined;
    if (answer.choice === 'include') selected.push(column.name);
    else if (answer.choice !== 'exclude') return undefined;
  }
  return selected.length > 0 ? selected : undefined;
}

function explicitHttpSelectColumns(
  columns: readonly TableColumn[],
  requestedColumns: readonly string[] | undefined,
): string[] | undefined {
  if (!requestedColumns?.length) return undefined;
  const unique = [...new Set(requestedColumns)];
  return unique.every((name) => columns.some((column) => column.name === name)) ? unique : undefined;
}

function clarifyMessage(filter: boolean, sort: boolean): string {
  if (filter && sort) return '필터에 사용할 열과 기준값, 정렬 기준을 구체적으로 알려 주세요.';
  if (filter) return '필터에 사용할 열과 기준값을 구체적으로 알려 주세요.';
  return '정렬할 열과 오름차순 또는 내림차순을 알려 주세요.';
}

/** Jev selects only bounded schema/value choices; the host evaluates the typed transform locally. */
export async function applyJevTableTransform(input: {
  decisionEngine: DecisionEngine;
  table: TableArtifact;
  userMessage: string;
  mode?: JevTableTransformMode | 'none' | 'auto';
  selectRequestedColumns?: boolean;
  httpSelectedColumns?: readonly string[];
  abortSignal?: AbortSignal;
}): Promise<JevTableTransformResult> {
  const table = TableArtifactSchema.safeParse(input.table);
  if (!table.success) return { status: 'not_applicable' };

  const automatic = !input.mode || input.mode === 'auto';
  let wantsFilter = automatic || input.mode === 'filter' || input.mode === 'filter_sort';
  let wantsSort = automatic || input.mode === 'sort' || input.mode === 'filter_sort';
  const values = numericValues(input.userMessage);
  if (!automatic && wantsFilter && values.length === 0) {
    return { status: 'clarify', message: clarifyMessage(wantsFilter, wantsSort) };
  }

  const questions: Record<string, DecisionQuestion> = {};
  const filterColumnGroups = wantsFilter ? columnChoiceGroups(table.data.columns, 'filter_column') : [];
  const sortColumnGroups = wantsSort ? columnChoiceGroups(table.data.columns, 'sort_column') : [];
  const directDisplayColumns = input.selectRequestedColumns && input.mode === 'none'
    ? explicitHttpSelectColumns(table.data.columns, input.httpSelectedColumns)
    : undefined;
  if (automatic) {
    questions.table_transform = {
      type: 'choice',
      instructions: {
        question: 'Does the user request a filter or sort after the read result, or should it be shown as-is?',
        focus: 'Choose none for a plain display or summary. Choose a transformation only when requested by meaning. Choose none if the requested conditions cannot be represented by one filter and one sort.',
      },
      criteria: JEV_TABLE_TRANSFORM_CRITERIA,
    };
  }
  const operatorCriteria: Record<string, DecisionInstruction> = {
    none: 'The comparison is ambiguous, unsupported, or contains more conditions than this operation can represent.',
    gt: 'Strictly greater than (>)',
    gte: 'Greater than or equal to (>=)',
    lt: 'Strictly less than (<)',
    lte: 'Less than or equal to (<=)',
  };
  if (wantsFilter) {
    for (const group of filterColumnGroups) {
      questions[group.questionId] = {
        type: 'choice',
        instructions: FILTER_COLUMN_INSTRUCTIONS,
        criteria: group.criteria,
      };
    }
    questions.filter_operator = {
      type: 'choice',
      instructions: {
        question: 'Which comparison operator matches the user wording?',
        focus: 'Choose the comparison that matches the user wording. Choose none if ambiguous, unsupported, or if multiple conditions cannot be represented safely.',
      },
      criteria: operatorCriteria,
    };
    questions.filter_value = {
      type: 'choice',
      instructions: {
        question: 'Which numeric literal in the request is the filter threshold?',
        focus: 'Choose the value attached to the comparison, not a page size or unrelated number. Never invent a value.',
      },
      criteria: valueCriteria(values),
    };
  }
  if (wantsSort) {
    for (const group of sortColumnGroups) {
      questions[group.questionId] = {
        type: 'choice',
        instructions: SORT_COLUMN_INSTRUCTIONS,
        criteria: group.criteria,
      };
    }
    questions.sort_direction = {
      type: 'choice',
      instructions: {
        question: 'Which direction matches the requested ordering?',
        focus: 'Map explicit low-to-high/lower-first wording to asc and high-to-low/higher-first wording to desc. For a plain numeric sort such as 가격순 with no direction, use the conventional ascending order; choose desc for requests like most expensive/highest first. Choose none only when the requested order is genuinely unclear.',
      },
      criteria: {
        none: 'The requested sort direction is unclear.',
        asc: 'Ascending order.',
        desc: 'Descending order.',
      },
    };
  }
  if (input.selectRequestedColumns && !directDisplayColumns) {
    Object.assign(questions, displayColumnQuestions(table.data.columns));
  }

  let answers: Record<string, DecisionAnswer> = {};
  const evaluationMetadata: JevEvaluationMetadata = { providerRequestCount: 0 };
  if (Object.keys(questions).length > 0) {
    let evaluation;
    try {
      input.abortSignal?.throwIfAborted();
      evaluation = await input.decisionEngine.evaluate({
        state: {
          request: input.userMessage,
          ...(input.selectRequestedColumns ? { task: DISPLAY_COLUMN_TASK } : {}),
          policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
        },
        questions,
        signal: input.abortSignal,
      });
      input.abortSignal?.throwIfAborted();
    } catch (error) {
      if (input.abortSignal?.aborted) throw new Error('ax_command_chat_timeout');
      const providerRequestCount = decisionProviderRequestCountFromError(error);
      return {
        status: 'unavailable',
        ...(providerRequestCount === undefined ? {} : { providerRequestCount }),
      };
    }
    answers = evaluation.answers;
    evaluationMetadata.providerRequestCount = evaluation.providerRequestCount ?? 1;
    if (evaluation.model) evaluationMetadata.model = evaluation.model;
    if (evaluation.usage) evaluationMetadata.usage = evaluation.usage;
  }

  if (automatic) {
    const selectedMode = selectedChoice(answers.table_transform, new Set([
      ...Object.keys(JEV_TABLE_TRANSFORM_CRITERIA),
    ]));
    if (!selectedMode) {
      return {
        status: 'clarify',
        message: '필터나 정렬 요청을 명확히 판단하지 못했습니다. 기준을 조금 더 구체적으로 알려 주세요.',
        ...evaluationMetadata,
      };
    }
    if (selectedMode === 'none' && !input.selectRequestedColumns) {
      return { status: 'not_applicable', ...evaluationMetadata };
    }
    if (selectedMode === 'none') {
      wantsFilter = false;
      wantsSort = false;
    } else {
      const mode = selectedMode as JevTableTransformMode;
      wantsFilter = mode === 'filter' || mode === 'filter_sort';
      wantsSort = mode === 'sort' || mode === 'filter_sort';
      if (wantsFilter && values.length === 0) {
        return { status: 'clarify', message: clarifyMessage(wantsFilter, wantsSort), ...evaluationMetadata };
      }
    }
  }

  let selectedColumns: Partial<Record<'filter_column' | 'sort_column', string>> | undefined;
  try {
    selectedColumns = await resolveColumnSelections({
      decisionEngine: input.decisionEngine,
      request: input.userMessage,
      selections: [
        ...(wantsFilter ? [{ field: 'filter_column' as const, groups: filterColumnGroups, instructions: FILTER_COLUMN_INSTRUCTIONS }] : []),
        ...(wantsSort ? [{ field: 'sort_column' as const, groups: sortColumnGroups, instructions: SORT_COLUMN_INSTRUCTIONS }] : []),
      ],
      answers,
      abortSignal: input.abortSignal,
      metadata: evaluationMetadata,
    });
  } catch (error) {
    if (input.abortSignal?.aborted) throw new Error('ax_command_chat_timeout');
    const providerRequestCount = decisionProviderRequestCountFromError(error);
    return {
      status: 'unavailable',
      providerRequestCount: evaluationMetadata.providerRequestCount + (providerRequestCount ?? 0),
    };
  }
  if (!selectedColumns) {
    return { status: 'clarify', message: clarifyMessage(wantsFilter, wantsSort), ...evaluationMetadata };
  }
  const displayColumns = input.selectRequestedColumns
    ? directDisplayColumns ?? selectedDisplayColumns(table.data.columns, answers)
    : undefined;
  if (input.selectRequestedColumns && !displayColumns) {
    return {
      status: 'clarify',
      message: '표시할 열을 정확히 판단하지 못했습니다. 보여줄 열 이름을 구체적으로 알려 주세요.',
      ...evaluationMetadata,
    };
  }

  let expression: TransformExpr = { op: 'source', sourceId: SOURCE_ID };
  if (wantsFilter) {
    const field = selectedColumns.filter_column;
    const operator = selectedChoice(answers.filter_operator,
      new Set(Object.keys(operatorCriteria).filter((key) => key !== 'none')));
    const valueChoice = selectedChoice(answers.filter_value, new Set([
      ...values.map((_, index) => `value_${index}`),
    ]));
    const value = valueChoice ? selectedValue(valueChoice, values) : undefined;
    if (!field || !table.data.columns.some((column) => column.name === field)
      || !operator || !valueChoice || value === undefined) {
      return {
        status: 'clarify',
        message: clarifyMessage(wantsFilter, wantsSort),
        ...evaluationMetadata,
      };
    }
    expression = {
      op: 'filter',
      input: expression,
      where: { op: operator as ComparisonOperator, left: { ref: field }, right: { lit: value } },
    };
  }
  if (wantsSort) {
    const field = selectedColumns.sort_column;
    const direction = selectedChoice(answers.sort_direction, new Set(['asc', 'desc']));
    if (!field || !table.data.columns.some((column) => column.name === field)
      || !direction) {
      return {
        status: 'clarify',
        message: clarifyMessage(wantsFilter, wantsSort),
        ...evaluationMetadata,
      };
    }
    expression = { op: 'sort', input: expression, by: [{ column: field, direction: direction as 'asc' | 'desc' }] };
  }
  if (displayColumns) expression = { op: 'select', input: expression, columns: displayColumns };

  const parsedExpression = TransformExprSchema.safeParse(expression);
  if (!parsedExpression.success) return { status: 'clarify', message: clarifyMessage(wantsFilter, wantsSort), ...evaluationMetadata };
  const transformed = TableArtifactSchema.safeParse(
    evaluateTransformExpr(parsedExpression.data, { [SOURCE_ID]: table.data }),
  );
  if (!transformed.success) return { status: 'clarify', message: clarifyMessage(wantsFilter, wantsSort), ...evaluationMetadata };

  const result = {
    ...transformed.data,
    profile: profileTable(transformed.data.columns, transformed.data.rows),
  };
  return {
    status: 'transformed',
    table: result,
    ...evaluationMetadata,
  };
}

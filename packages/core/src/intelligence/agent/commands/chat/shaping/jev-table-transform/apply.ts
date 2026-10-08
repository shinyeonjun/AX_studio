import type { DecisionAnswer, DecisionEngine } from '../../../../../../contracts/decision.js';
import { decisionProviderRequestCountFromError } from '../../../../../../contracts/decision.js';
import { TableArtifactSchema, type TableArtifact } from '../../../../../../contracts/artifacts/table.js';
import { DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../../../decision/context.js';
import { selectedChoice, type JevEvaluationMetadata } from '../jev-table-shared.js';
import { summarizeTable } from '../jev-table-summary.js';
import {
  columnChoiceGroups,
  explicitHttpSelectColumns,
  FILTER_COLUMN_INSTRUCTIONS,
  resolveColumnSelections,
  selectedDisplayColumns,
  SORT_COLUMN_INSTRUCTIONS,
} from './columns.js';
import {
  JEV_TABLE_TRANSFORM_CRITERIA,
  type JevTableTransformMode,
  type JevTableTransformResult,
} from './contract.js';
import { applySelectedTransform, clarifyMessage } from './expression.js';
import { DISPLAY_COLUMN_TASK, numericValues, transformQuestions } from './questions.js';

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
  if (input.mode === 'export_xlsx') return { status: 'export_xlsx' };
  if (input.mode === 'unsupported') return { status: 'clarify', message: '요청한 변환은 이 표에서 할 수 없어 수행하지 않았습니다. 행 거르기·정렬·열 고르기·합계는 할 수 있습니다.' };
  const table = TableArtifactSchema.safeParse(input.table);
  if (!table.success) return { status: 'not_applicable' };
  if (input.mode === 'calculate') {
    return summarizeTable({ decisionEngine: input.decisionEngine, table: table.data, userMessage: input.userMessage, abortSignal: input.abortSignal });
  }

  const automatic = !input.mode || input.mode === 'auto';
  let wantsFilter = automatic || input.mode === 'filter' || input.mode === 'filter_sort';
  let wantsSort = automatic || input.mode === 'sort' || input.mode === 'filter_sort';
  const values = numericValues(input.userMessage);

  const filterColumnGroups = wantsFilter ? columnChoiceGroups(table.data.columns, 'filter_column') : [];
  const sortColumnGroups = wantsSort ? columnChoiceGroups(table.data.columns, 'sort_column') : [];
  const directDisplayColumns = input.selectRequestedColumns && input.mode === 'none'
    ? explicitHttpSelectColumns(table.data.columns, input.httpSelectedColumns)
    : undefined;
  const questions = transformQuestions({
    automatic,
    wantsFilter,
    wantsSort,
    filterColumnGroups,
    sortColumnGroups,
    values,
    ...(input.selectRequestedColumns && !directDisplayColumns ? { displayColumns: table.data.columns } : {}),
  });

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
    if (selectedMode === 'export_xlsx') return { status: 'export_xlsx', ...evaluationMetadata };
    if (selectedMode === 'calculate') {
      return summarizeTable({ decisionEngine: input.decisionEngine, table: table.data, userMessage: input.userMessage, abortSignal: input.abortSignal, metadata: evaluationMetadata });
    }
    if (selectedMode === 'unsupported') return { status: 'clarify', message: '요청한 변환은 이 표에서 할 수 없어 수행하지 않았습니다. 행 거르기·정렬·열 고르기·합계는 할 수 있습니다.', ...evaluationMetadata };
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

  return applySelectedTransform({
    decisionEngine: input.decisionEngine,
    table: table.data,
    userMessage: input.userMessage,
    abortSignal: input.abortSignal,
    wantsFilter,
    wantsSort,
    selectedColumns,
    displayColumns,
    answers,
    values,
    metadata: evaluationMetadata,
  });
}

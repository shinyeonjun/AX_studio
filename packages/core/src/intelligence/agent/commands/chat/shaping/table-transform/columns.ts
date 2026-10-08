import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionInstruction,
  DecisionQuestion,
} from '../../../../../../contracts/decision.js';
import type { TableArtifact } from '../../../../../../contracts/artifacts/table.js';
import { boundDecisionString, DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../../../decision/context.js';
import { groupJevChoiceCandidates } from '../../shared/choice-grouping.js';
import { accumulateEvaluationMetadata, selectedChoice, type JevEvaluationMetadata } from '../table-shared.js';

export const FILTER_COLUMN_INSTRUCTIONS: DecisionInstruction = {
  question: 'Which result column is constrained by the requested comparison?',
  focus: 'Choose only a schema column explicitly supported by the user request. If none fits, choose none.',
};
export const SORT_COLUMN_INSTRUCTIONS: DecisionInstruction = {
  question: 'Which result column should determine row order?',
  focus: 'Choose only a schema column supported by the request; choose none if the sort key is unclear.',
};

function columnLabel(column: TableColumn): string {
  return boundDecisionString(column.label?.trim() || column.name, 160);
}

export type TableColumn = TableArtifact['columns'][number];
type ColumnCandidate = { key: string; column: TableColumn };
export type ColumnChoiceGroup = {
  questionId: string;
  candidates: readonly ColumnCandidate[];
  criteria: Record<string, DecisionInstruction>;
};

export function columnChoiceGroups(
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

type ColumnSelection = {
  field: 'filter_column' | 'sort_column';
  groups: ColumnChoiceGroup[];
  instructions: DecisionInstruction;
};

/** Narrows each grouped column question to one column, asking follow-up rounds while several remain. */
export async function resolveColumnSelections(input: {
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

export function displayColumnQuestions(columns: readonly TableColumn[]): Record<string, DecisionQuestion> {
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

export function selectedDisplayColumns(
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

export function explicitHttpSelectColumns(
  columns: readonly TableColumn[],
  requestedColumns: readonly string[] | undefined,
): string[] | undefined {
  if (!requestedColumns?.length) return undefined;
  const unique = [...new Set(requestedColumns)];
  return unique.every((name) => columns.some((column) => column.name === name)) ? unique : undefined;
}

import type { DecisionInstruction, DecisionQuestion } from '../../../../../contracts/decision.js';
import {
  displayColumnQuestions,
  FILTER_COLUMN_INSTRUCTIONS,
  SORT_COLUMN_INSTRUCTIONS,
  type ColumnChoiceGroup,
  type TableColumn,
} from './columns.js';
import { JEV_TABLE_TRANSFORM_CRITERIA } from './contract.js';

export const DISPLAY_COLUMN_TASK = 'Select only fields explicitly named or clearly requested by meaning. Exclude unrelated fields; use unclear only for genuine ambiguity.';

export const OPERATOR_CRITERIA: Record<string, DecisionInstruction> = {
  none: 'The comparison is ambiguous, unsupported, or contains more conditions than this operation can represent.',
  eq: 'Equal to the requested value (=)',
  neq: 'Not equal to the requested value (exclude matching rows)',
  gt: 'Strictly greater than (>)',
  gte: 'Greater than or equal to (>=)',
  lt: 'Strictly less than (<)',
  lte: 'Less than or equal to (<=)',
};

export function numericValues(message: string): number[] {
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

/** One evaluation asks the mode (when automatic), filter and sort parts, and display columns together. */
export function transformQuestions(input: {
  automatic: boolean;
  wantsFilter: boolean;
  wantsSort: boolean;
  filterColumnGroups: readonly ColumnChoiceGroup[];
  sortColumnGroups: readonly ColumnChoiceGroup[];
  values: readonly number[];
  displayColumns?: readonly TableColumn[];
}): Record<string, DecisionQuestion> {
  const questions: Record<string, DecisionQuestion> = {};
  if (input.automatic) {
    questions.table_transform = {
      type: 'choice',
      instructions: {
        question: 'Does the user request a filter, a sort or a computed summary (count, total, average) of the read result, or should it be shown as-is?',
        focus: 'Choose none for a plain display or a prose summary. Choose calculate when the user asks for a number computed from the rows (count, total, average, min, max), overall or per group. Choose a filter or sort only when requested by meaning. Choose export_xlsx only for an Excel export of the current table without changes. Choose unsupported for other operations.',
      },
      criteria: JEV_TABLE_TRANSFORM_CRITERIA,
    };
  }
  if (input.wantsFilter) {
    for (const group of input.filterColumnGroups) {
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
      criteria: OPERATOR_CRITERIA,
    };
    questions.filter_value = {
      type: 'choice',
      instructions: {
        question: 'Which numeric literal in the request is the filter threshold?',
        focus: 'Choose the value attached to the comparison, not a page size or unrelated number. Never invent a value.',
      },
      criteria: valueCriteria(input.values),
    };
  }
  if (input.wantsSort) {
    for (const group of input.sortColumnGroups) {
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
  if (input.displayColumns) {
    Object.assign(questions, displayColumnQuestions(input.displayColumns));
  }
  return questions;
}

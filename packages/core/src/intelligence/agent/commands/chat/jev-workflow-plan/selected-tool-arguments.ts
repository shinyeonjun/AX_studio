import type { DecisionAnswer, DecisionQuestion } from '../../../../../contracts/decision.js';
import type { ConnectorCapability } from '../../../../../catalog/capability-types.js';
import type { JevReadOperationHint } from '../../../../decision/read-operation-catalog.js';
import { jevActionQuotedInputMapping, type JevActionInputValue } from '../jev-action-catalog.js';
import { jevActionInputQuestion } from '../jev-decision-request.js';
import {
  applyJevReadOperationParameterAnswers,
  jevReadOperationParameterQuestions,
  type JevReadOperationParameterField,
} from '../jev-read-parameters.js';
import type { ActionPlanCandidate } from '../jev-workflow-plan-types.js';
import type { JevPlanMode } from './shared.js';

export interface PlanEntry {
  candidate: ActionPlanCandidate;
  id: string;
}

interface ActionInputMapping {
  entry: PlanEntry;
  value: string;
  params: ConnectorCapability['params'];
}

interface ReadFieldSelection {
  hint: JevReadOperationHint;
  fields: JevReadOperationParameterField[];
}

export interface ArgumentQuestions {
  questions: Record<string, DecisionQuestion>;
  actionMappings: Map<string, ActionInputMapping>;
  readFields: Map<string, ReadFieldSelection>;
}

/** Step ids never collide with steps the workflow keeps; a one-off run numbers them action_N. */
export function assignStepIds(
  candidates: readonly ActionPlanCandidate[],
  mode: JevPlanMode,
  existingIds: ReadonlySet<string>,
): { entries: PlanEntry[]; stepIds: Set<string> } {
  const stepIds = new Set(existingIds);
  const entries = candidates.map((candidate, index) => {
    const preferred = mode === 'one_shot' ? `action_${index + 1}` : `jev_step_${index + 1}`;
    let id = preferred;
    let suffix = index + 1;
    while (stepIds.has(id)) id = `jev_step_${++suffix}`;
    stepIds.add(id);
    return { candidate, id };
  });
  return { entries, stepIds };
}

/**
 * Asks read parameters and ambiguous quoted action inputs in one phase. A quote that fits
 * exactly one field is taken directly into `inputValues`. Returns a reason when a quote cannot
 * be tied to the tool at all.
 */
export function argumentQuestions(
  entries: readonly PlanEntry[],
  request: string,
  inputValues: JevActionInputValue[],
): ArgumentQuestions | { failure: string } {
  const questions: Record<string, DecisionQuestion> = {};
  const actionMappings = new Map<string, ActionInputMapping>();
  const readFields = new Map<string, ReadFieldSelection>();

  for (const [index, entry] of entries.entries()) {
    const { candidate, id } = entry;
    if (candidate.readOperationHint) {
      const prefix = `read_parameter_${index}`;
      const selection = jevReadOperationParameterQuestions(candidate.readOperationHint, prefix);
      Object.assign(questions, selection.questions);
      readFields.set(candidate.readOperationHint.key, { hint: candidate.readOperationHint, fields: selection.fields });
      continue;
    }
    const mapping = jevActionQuotedInputMapping(candidate.capability, request, inputValues, id);
    if (!mapping) continue;
    if (mapping.kind === 'uncertain') {
      return { failure: `인용한 문구를 ${candidate.capability.label}의 입력값에 명확히 연결하지 못했습니다.` };
    }
    if (mapping.params.length === 1) {
      inputValues.push({
        label: mapping.params[0]!.label,
        value: mapping.value,
        stepId: id,
        capabilityId: candidate.capability.id,
        parameterName: mapping.params[0]!.name,
      });
    } else {
      const questionId = `action_input_${index}`;
      actionMappings.set(questionId, { entry, value: mapping.value, params: mapping.params });
      questions[questionId] = jevActionInputQuestion(mapping.params);
    }
  }
  return { questions, actionMappings, readFields };
}

/**
 * Applies the accepted argument answers: chosen action fields join `inputValues`, and each read
 * entry takes its resolved parameters. Returns a reason when an answer leaves a value unknown.
 */
export function applyArgumentAnswers(
  entries: PlanEntry[],
  selection: ArgumentQuestions,
  answers: Record<string, DecisionAnswer>,
  inputValues: JevActionInputValue[],
): string | undefined {
  for (const [questionId, mapping] of selection.actionMappings) {
    const answer = answers[questionId];
    if (answer?.type !== 'choice') return '도구 입력값을 확정하지 못했습니다.';
    const match = /^field_(\d+)$/u.exec(answer.choice);
    const param = match ? mapping.params[Number(match[1])] : undefined;
    if (!param) return '도구 입력값을 확정하지 못했습니다.';
    inputValues.push({
      label: param.label,
      value: mapping.value,
      stepId: mapping.entry.id,
      capabilityId: mapping.entry.candidate.capability.id,
      parameterName: param.name,
    });
  }
  for (const entry of entries) {
    const hint = entry.candidate.readOperationHint;
    if (hint) {
      const fields = selection.readFields.get(hint.key);
      const resolved = fields ? applyJevReadOperationParameterAnswers(hint, fields.fields, answers) : hint;
      if (resolved.missingParameterPaths?.length) return '조회 입력이 필요합니다.';
      entry.candidate = { ...entry.candidate, readOperationHint: resolved, params: resolved.params };
    }
  }
  return undefined;
}

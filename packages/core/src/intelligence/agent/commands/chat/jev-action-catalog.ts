import { availableCapabilities, capabilityActionName, resolveCapability } from '../../../../catalog/capability-graph.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import { type DecisionAnswer, type DecisionInstruction } from '../../../../contracts/decision.js';
import { boundDecisionString } from '../../../decision/context.js';
import { groupJevChoiceCandidates, MAX_JEV_CHOICE_CANDIDATES } from './jev-choice-grouping.js';
import { actionRefFor } from '../../../../workflow/action-definition.js';
import { AxExecutionEnqueueOnceArgsSchema, type AxCommand } from '../schema.js';
import { AxWorkflowCreateArgsSchema, AxWorkflowUpdateArgsSchema } from '../schema/workflow-args.js';
import { AxJobProposeArgsSchema, type AxJobProposeArgs } from '../job-registration/contract.js';

const JEV_ACTION_MAX_CHOICES = MAX_JEV_CHOICE_CANDIDATES;
const SENSITIVE_PARAM = /(?:api[_-]?key|authorization|cookie|password|secret|token)/iu;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const QUOTED = /"([^"\r\n]{1,2000})"|“([^”\r\n]{1,2000})”|「([^」\r\n]{1,2000})」|『([^』\r\n]{1,2000})』|'([^'\r\n]{1,2000})'/gu;
const FIELD_VALUE_PARTICLE = '(?:([:=])|(은|는))';

export interface JevActionHint {
  key: string;
  capability: ConnectorCapability;
}

export interface JevActionQuestionGroup {
  questionId: string;
  hints: readonly JevActionHint[];
  criteria: Record<string, DecisionInstruction>;
}

export interface JevActionInputValue {
  label: string;
  value: string;
  target?: 'trigger' | 'job';
  stepId?: string;
  capabilityId?: string;
  parameterName?: string;
}

export function selectJevActionHints(
  connectedConnectors: readonly string[],
  capabilities: readonly ConnectorCapability[] = availableCapabilities([...connectedConnectors]),
): { hints: JevActionHint[]; catalogSize: number; catalogMayBeBounded: boolean } {
  const actions = capabilities
    .filter((capability) => connectedConnectors.includes(capability.connector))
    .filter((capability) => capability.kind === 'write')
    .filter((capability) => !capability.params.some((param) => param.required && SENSITIVE_PARAM.test(param.name)));
  return {
    hints: actions.map((capability, index) => ({ key: `action_${index}`, capability })),
    catalogSize: actions.length,
    catalogMayBeBounded: false,
  };
}

export function jevActionQuestionGroups(
  hints: readonly JevActionHint[],
  questionPrefix = 'action',
): JevActionQuestionGroup[] {
  const criteria = jevActionCriteria(hints);
  const groups = groupJevChoiceCandidates(
    hints,
    questionPrefix,
    (hint) => hint.key,
    (hint) => criteria[hint.key]!,
  );
  return groups.map(({ questionId, candidates, criteria: groupCriteria }) => ({
    questionId: questionPrefix === 'action' && groups.length === 1 ? 'action' : questionId,
    hints: candidates,
    criteria: groupCriteria,
  }));
}

export function jevActionCriteria(hints: readonly JevActionHint[]): Record<string, DecisionInstruction> {
  // The opaque key maps back to host-owned policy; flatten metadata to avoid
  // repeating JSON field names for every candidate in large connected catalogs.
  // Required inputs stay host-owned and are resolved only after an action wins.
  return Object.fromEntries(hints.map(({ key, capability }) => {
    const identity = `${boundDecisionString(capability.connector, 128)}.${boundDecisionString(capabilityActionName(capability), 128)}`;
    const description = [...new Set([
      boundDecisionString(capability.label, 120),
      boundDecisionString(capability.description, 240),
    ].filter(Boolean))].join(': ');
    return [key, [identity, description].filter(Boolean).join(' — ')];
  }));
}

function explicitNamedValue(message: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = message.match(new RegExp(`(?:^|[\\s,;])${escaped}\\s*[:=]\\s*(?:"([^"]*)"|“([^”]*)”|'([^']*)'|([^\\s,;]+))`, 'iu'));
  const value = match?.slice(1).find((part): part is string => typeof part === 'string');
  return value?.trim() || undefined;
}

function explicitFieldMarker(param: ConnectorCapability['params'][number]): RegExp {
  const labels = [...new Set([param.name, param.label].map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:^|[\\s,;])(?:${labels.join('|')})\\s*${FIELD_VALUE_PARTICLE}\\s*`, 'giu');
}

function explicitLabeledInput(
  message: string,
  param: ConnectorCapability['params'][number],
  params: readonly ConnectorCapability['params'][number][],
): string | undefined {
  const markers = [...message.matchAll(explicitFieldMarker(param))];
  if (markers.length !== 1) return undefined;
  const marker = markers[0]!;
  const start = marker.index! + marker[0].length;
  const remaining = message.slice(start);
  let end = remaining.search(/[;\r\n]/u);
  let hasValueBoundary = end >= 0;
  for (const other of params) {
    if (other.name === param.name) continue;
    const next = explicitFieldMarker(other).exec(remaining)?.index;
    if (next !== undefined && (end < 0 || next < end)) {
      end = next;
      hasValueBoundary = true;
    }
  }
  const value = remaining.slice(0, end < 0 ? undefined : end).trim().replace(/[,，]$/u, '').trim().slice(0, 2_000);
  if (!value) return undefined;
  const quoted = /^(?:"([^"\r\n]*)"|“([^”\r\n]*)”|「([^」\r\n]*)」|『([^』\r\n]*)』|'([^'\r\n]*)')/u.exec(value);
  const quotedValue = quoted?.slice(1).find((part): part is string => typeof part === 'string');
  if (marker[2] && !quotedValue && !hasValueBoundary) return undefined;
  return quotedValue ?? value;
}

function explicitParamValue(
  message: string,
  param: ConnectorCapability['params'][number],
  params: readonly ConnectorCapability['params'][number][],
): string | undefined {
  if (SENSITIVE_PARAM.test(param.name)) return undefined;
  const named = explicitNamedValue(message, param.name) ?? explicitLabeledInput(message, param, params);
  if (named) return named.slice(0, 2_000);
  if (param.inputType === 'email') {
    const addresses = [...new Set(message.match(EMAIL) ?? [])];
    return addresses.length === 1 ? addresses[0] : undefined;
  }
  if (param.inputType === 'slack_channel' || param.inputType === 'folder') return undefined;
  return undefined;
}

function inputMatchesParam(
  input: JevActionInputValue,
  capability: ConnectorCapability,
  param: ConnectorCapability['params'][number],
  stepId?: string,
): boolean {
  const scoped = input.target !== undefined || input.stepId !== undefined
    || input.capabilityId !== undefined || input.parameterName !== undefined;
  return scoped
    ? input.stepId === stepId && input.capabilityId === capability.id && input.parameterName === param.name
    : input.label === param.label;
}

/** Exposes the exact quoted user value and compatible schema fields for Jev to map. */
export function jevActionQuotedInputMapping(
  capability: ConnectorCapability,
  userMessage: string,
  inputValues: readonly JevActionInputValue[] = [],
  stepId?: string,
): { kind: 'mapping'; value: string; params: ConnectorCapability['params'] } | { kind: 'uncertain' } | undefined {
  if (capability.params.length === 0) return undefined;
  const quotedValues = [...userMessage.matchAll(QUOTED)].map((match) =>
    match.slice(1).find((part): part is string => typeof part === 'string')?.trim(),
  ).filter((value): value is string => Boolean(value));
  if (quotedValues.length === 0) return undefined;

  const assignedValues = new Set<string>();
  const assignedParams = new Set<string>();
  for (const param of capability.params) {
    const explicit = explicitParamValue(userMessage, param, capability.params);
    if (explicit !== undefined) {
      assignedValues.add(explicit);
      assignedParams.add(param.name);
    }
    const provided = inputValues.find((input) => inputMatchesParam(input, capability, param, stepId));
    if (provided) {
      assignedValues.add(provided.value);
      assignedParams.add(param.name);
    }
  }

  const unassigned = quotedValues.filter((value) => !assignedValues.has(value));
  if (unassigned.length === 0) return undefined;
  if (unassigned.length !== 1) return { kind: 'uncertain' };
  const params = capability.params.filter((param) =>
    !assignedParams.has(param.name)
      && !SENSITIVE_PARAM.test(param.name)
      && (param.inputType === undefined || param.inputType === 'text'));
  return params.length > 0 && params.length <= JEV_ACTION_MAX_CHOICES
    ? { kind: 'mapping', value: unassigned[0]!, params }
    : { kind: 'uncertain' };
}

export function compileJevOneShotAction(
  hints: readonly JevActionHint[],
  answer: DecisionAnswer | undefined,
  userMessage: string,
  inputValues: readonly JevActionInputValue[] = [],
): AxCommand | undefined {
  if (answer?.type !== 'choice') return undefined;
  const capability = hints.find((hint) => hint.key === answer.choice)?.capability;
  if (!capability) return undefined;
  const action = capabilityActionName(capability);
  const params = compileJevActionParams(capability, userMessage, inputValues, 'action_1');

  return {
    name: 'execution.enqueue_once',
    args: {
      name: `${capability.label} — 일회 실행`.slice(0, 120),
      goal: userMessage.trim().slice(0, 2_000),
      steps: [{
        type: 'action',
        id: 'action_1',
        connector: capability.connector,
        action,
        actionRef: actionRefFor(capability.connector, action),
        params,
      }],
    },
  };
}

export function compileJevActionParams(
  capability: ConnectorCapability,
  userMessage: string,
  inputValues: readonly JevActionInputValue[] = [],
  stepId?: string,
): Record<string, unknown> {
  return Object.fromEntries(capability.params.flatMap((param) => {
    const provided = inputValues.filter((input) => inputMatchesParam(input, capability, param, stepId));
    const value = provided.length === 1
      ? provided[0]?.value
      : provided.length === 0 ? explicitParamValue(userMessage, param, capability.params) : undefined;
    return value === undefined ? [] : [[param.name, value]];
  }));
}

function applyTriggerInputValues(
  trigger: unknown,
  inputValues: readonly JevActionInputValue[],
): unknown {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return trigger;
  const record = trigger as Record<string, unknown>;
  const updates = Object.fromEntries(inputValues.flatMap((input) =>
    input.target === 'trigger'
      && input.parameterName
      && input.parameterName !== 'type'
      && Object.hasOwn(record, input.parameterName)
      && typeof record[input.parameterName] === 'string'
      ? [[input.parameterName, input.value]]
      : [],
  ));
  return Object.keys(updates).length > 0 ? { ...record, ...updates } : trigger;
}

function applyStepInputValues(
  steps: readonly unknown[],
  inputValues: readonly JevActionInputValue[],
): unknown[] {
  return steps.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
    const record = step as Record<string, unknown>;
    if (record.type !== 'action' || typeof record.connector !== 'string'
      || typeof record.action !== 'string' || typeof record.id !== 'string') return step;
    const action = typeof record.actionRef === 'string' ? record.actionRef : record.action;
    const capability = resolveCapability(record.connector, action);
    if (!capability || capability.kind === 'trigger') return step;
    return {
      ...record,
      params: {
        ...(record.params && typeof record.params === 'object' && !Array.isArray(record.params)
          ? record.params as Record<string, unknown>
          : {}),
        ...compileJevActionParams(capability, '', inputValues, record.id),
      },
    };
  });
}

function applyJobInputValues(
  args: AxJobProposeArgs,
  inputValues: readonly JevActionInputValue[],
): Record<string, unknown> {
  const updates = new Map<string, string>();
  for (const input of inputValues) {
    if (input.target !== 'job' || !input.parameterName) continue;
    if (input.parameterName === 'fetch.connectionId' || input.parameterName === 'notify.channel') {
      if (!updates.has(input.parameterName)) updates.set(input.parameterName, input.value);
      else updates.set(input.parameterName, '');
    }
  }
  const connectionId = updates.get('fetch.connectionId');
  const channel = updates.get('notify.channel');
  return {
    ...(connectionId ? { fetch: { ...args.fetch, connectionId } } : {}),
    ...(channel ? { notify: { ...args.notify, channel } } : {}),
  };
}

/** Applies host-collected values to the exact saved command; the command is revalidated by the host. */
export function applyJevCommandInputValuesToCommand(
  command: AxCommand,
  inputValues: readonly JevActionInputValue[],
): AxCommand | undefined {
  if (command.name === 'execution.enqueue_once') {
    const parsed = AxExecutionEnqueueOnceArgsSchema.safeParse(command.args);
    if (!parsed.success) return undefined;
    return { name: command.name, args: { ...parsed.data, steps: applyStepInputValues(parsed.data.steps, inputValues) } };
  }
  if (command.name === 'workflow.create') {
    const parsed = AxWorkflowCreateArgsSchema.safeParse(command.args);
    if (!parsed.success) return undefined;
    return {
      name: command.name,
      args: {
        ...parsed.data,
        ...(parsed.data.trigger ? { trigger: applyTriggerInputValues(parsed.data.trigger, inputValues) } : {}),
        steps: applyStepInputValues(parsed.data.steps, inputValues),
      },
    };
  }
  if (command.name === 'workflow.update') {
    const parsed = AxWorkflowUpdateArgsSchema.safeParse(command.args);
    if (!parsed.success) return undefined;
    return {
      name: command.name,
      args: {
        ...parsed.data,
        operations: parsed.data.operations.map((operation) => operation.op === 'upsert_step'
          ? { ...operation, step: applyStepInputValues([operation.step], inputValues)[0]! }
          : operation),
      },
    };
  }
  if (command.name === 'job.propose') {
    const parsed = AxJobProposeArgsSchema.safeParse(command.args);
    if (!parsed.success) return undefined;
    const jobInputs = applyJobInputValues(parsed.data, inputValues);
    return {
      name: command.name,
      args: {
        ...parsed.data,
        ...jobInputs,
        ...(parsed.data.trigger ? { trigger: applyTriggerInputValues(parsed.data.trigger, inputValues) } : {}),
        ...(parsed.data.steps ? { steps: applyStepInputValues(parsed.data.steps, inputValues) } : {}),
      },
    };
  }
  return undefined;
}

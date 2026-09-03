import {
  capabilityActionName,
  resolveCapability,
} from '../../../catalog/capability-graph.js';
import { actionDefinitionFromCapability, actionRefFor } from '../../../workflow/action-definition.js';
import { resolveEffectiveSideEffect } from '../../../workflow/side-effect-resolve.js';
import {
  validateWorkflowIR,
  type Step,
  type WorkflowIR,
} from '../../../workflow/schema.js';
import {
  AxWorkflowCreateArgsSchema,
  AxWorkflowStepInputSchema,
  type AxCommand,
  type AxCommandIssue,
} from '../schema.js';
import { issue } from './validation.js';
import type { AxWorkflowCommandResult } from './contract.js';

export function candidateFromCreateCommand(
  command: AxCommand,
  schema: typeof AxWorkflowCreateArgsSchema,
): { ok: true; value: WorkflowIR } | { ok: false; result: AxWorkflowCommandResult } {
  const parsed = schema.safeParse(command.args);
  if (!parsed.success) {
    return { ok: false, result: ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]] };
  }

  const steps = normalizeStepInputs(parsed.data.steps);
  if (!steps.ok) return { ok: false, result: ['invalid', undefined, steps.issues] };

  return {
    ok: true,
    value: {
      name: parsed.data.name,
      goal: parsed.data.goal,
      version: 1,
      inputs: [],
      trigger: parsed.data.trigger,
      steps: steps.value,
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      success: parsed.data.success,
      assumptions: parsed.data.assumptions,
      sideEffects: sideEffectsFor(steps.value),
      dataPolicy: {},
    },
  };
}

export function normalizeStepInputs(inputs: unknown[]) {
  const value: Step[] = [];
  const issues: AxCommandIssue[] = [];
  for (const input of inputs) {
    const normalized = normalizeStepInput(input);
    if (!normalized.ok) issues.push(...normalized.issues);
    else value.push(normalized.value);
  }
  return issues.length > 0 ? { ok: false as const, issues } : { ok: true as const, value };
}

export function normalizeStepInput(input: unknown):
  | { ok: true; value: Step }
  | { ok: false; issues: AxCommandIssue[] } {
  const parsed = AxWorkflowStepInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [issue('invalid_step', parsed.error.message)] };
  if (parsed.data.type !== 'action') return { ok: true, value: parsed.data as Step };

  const capability = resolveCapability(parsed.data.connector, parsed.data.actionRef ?? parsed.data.action);
  if (!capability || capability.kind === 'trigger') {
    return { ok: false, issues: [issue('unknown_action', `catalog에서 action을 찾을 수 없습니다: ${parsed.data.connector}.${parsed.data.action}`, `steps.${parsed.data.id}`)] };
  }
  return {
    ok: true,
    value: {
      ...parsed.data,
      connector: capability.connector,
      action: capabilityActionName(capability),
      actionRef: actionRefFor(capability.connector, capabilityActionName(capability)),
      sideEffect: resolveEffectiveSideEffect(actionDefinitionFromCapability(capability), parsed.data.params),
    },
  };
}

export function sideEffectsFor(steps: Step[]): Record<string, WorkflowIR['sideEffects'][string]> {
  return Object.fromEntries(
    steps
      .filter((step): step is Extract<Step, { type: 'action' }> => step.type === 'action')
      .map((step) => [step.id, step.sideEffect]),
  );
}

export function applyWorkflowField(
  workflow: WorkflowIR,
  path: 'name' | 'goal' | 'trigger' | 'success' | 'assumptions',
  value: unknown,
): { ok: true } | { ok: false; issue: AxCommandIssue } {
  if (path === 'name' || path === 'goal' || path === 'success') {
    if (typeof value !== 'string' || (path !== 'success' && !value.trim())) {
      return { ok: false, issue: issue('invalid_field', `${path}는 문자열이어야 합니다.`, path) };
    }
    workflow[path] = value;
    return { ok: true };
  }
  if (path === 'assumptions') {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      return { ok: false, issue: issue('invalid_field', 'assumptions는 문자열 배열이어야 합니다.', path) };
    }
    workflow.assumptions = value;
    return { ok: true };
  }
  if (value == null) {
    workflow.trigger = undefined;
    return { ok: true };
  }
  const trigger = validateWorkflowIR({ ...workflow, trigger: value });
  if (!trigger.ok) return { ok: false, issue: issue('invalid_trigger', trigger.error, path) };
  workflow.trigger = trigger.value.trigger;
  return { ok: true };
}

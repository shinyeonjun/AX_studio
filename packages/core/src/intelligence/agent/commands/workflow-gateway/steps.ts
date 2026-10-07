import { verifyAuthoritativeRequestAnchor } from '../../../decision/request-anchor.js';
import {
  capabilityActionName,
  resolveCapability,
} from '../../../../catalog/capability-graph.js';
import { actionDefinitionFromCapability, actionRefFor } from '../../../../workflow/action-definition.js';
import { resolveEffectiveSideEffect } from '../../../../workflow/side-effect-resolve.js';
import {
  validateWorkflowIR,
  type Step,
  type WorkflowIR,
} from '../../../../workflow/schema.js';
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

  let requestAnchor;
  if (parsed.data.requestAnchor) {
    try {
      requestAnchor = verifyAuthoritativeRequestAnchor(parsed.data.requestAnchor);
      if (requestAnchor.text.trim() !== parsed.data.goal) throw new Error('request_anchor_mismatch');
    } catch {
      return { ok: false, result: ['invalid', undefined, [issue('request_anchor_mismatch', '처음 요청과 저장하려는 업무 내용이 맞지 않습니다. 원래 요청을 다시 보내 주세요.')]] };
    }
  }
  const steps = normalizeStepInputs(parsed.data.steps);
  if (!steps.ok) return { ok: false, result: ['invalid', undefined, steps.issues] };

  return {
    ok: true,
    value: {
      name: parsed.data.name,
      goal: requestAnchor?.text ?? parsed.data.goal,
      ...(requestAnchor ? { requestAnchor } : {}),
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

function normalizeStepInputs(inputs: unknown[]) {
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
    return { ok: false, issues: [issue('unknown_action', '지원하지 않는 작업이 들어 있습니다. 요청을 조금 바꿔 다시 시도해 주세요.', `steps.${parsed.data.id}`)] };
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

function sideEffectsFor(steps: Step[]): Record<string, WorkflowIR['sideEffects'][string]> {
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
      return { ok: false, issue: issue('invalid_field', '입력한 값의 형식이 올바르지 않습니다.', path) };
    }
    workflow[path] = value;
    return { ok: true };
  }
  if (path === 'assumptions') {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      return { ok: false, issue: issue('invalid_field', '입력한 값의 형식이 올바르지 않습니다.', path) };
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

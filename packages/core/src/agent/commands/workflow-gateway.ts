import {
  capabilityActionName,
  resolveCapability,
} from '../../catalog/capability-graph.js';
import { actionRefFor } from '../../workflow/action-definition.js';
import {
  validateWorkflowContracts,
  type ContractValidationIssue,
} from '../../workflow/contract-validator.js';
import {
  parseWorkflowIR,
  validateWorkflowIR,
  type Step,
  type WorkflowIR,
} from '../../workflow/schema.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import {
  AxExecutionEnqueueOnceArgsSchema,
  AxWorkflowCreateArgsSchema,
  AxWorkflowDeleteArgsSchema,
  AxWorkflowRunArgsSchema,
  AxWorkflowStepInputSchema,
  AxWorkflowUpdateArgsSchema,
  type AxCommand,
  type AxCommandIssue,
  type AxCommandName,
  type AxCommandResult,
} from './schema.js';

export type AxWorkflowCommandResult = [
  AxCommandResult['status'],
  unknown,
  AxCommandIssue[]?,
];

export interface AxWorkflowCommandGateway {
  list(): unknown;
  inspect(command: AxCommand): AxWorkflowCommandResult;
  validate(command: AxCommand): AxWorkflowCommandResult;
  create(command: AxCommand): AxWorkflowCommandResult;
  update(command: AxCommand): AxWorkflowCommandResult;
  delete(command: AxCommand): AxWorkflowCommandResult;
  run(command: AxCommand): Promise<AxWorkflowCommandResult>;
  enqueueOnce(command: AxCommand): Promise<AxWorkflowCommandResult>;
}

export function createWorkflowCommandGateway(
  store: WorkflowStore,
  options: {
    runWorkflow?: (workflowId: string) => Promise<unknown>;
    enqueueOnce?: (workflow: WorkflowIR) => Promise<unknown> | unknown;
  } = {},
): AxWorkflowCommandGateway {
  return {
    list: () => ({ workflows: store.listWorkflows() }),
    inspect: (command) => inspectWorkflow(store, command),
    validate: (command) => validateWorkflow(store, command),
    create: (command) => createWorkflow(store, command),
    update: (command) => updateWorkflow(store, command),
    delete: (command) => deleteWorkflow(store, command),
    run: (command) => runWorkflow(store, options.runWorkflow, command),
    enqueueOnce: (command) => enqueueOnce(store, options.enqueueOnce, command),
  };
}

async function runWorkflow(
  store: WorkflowStore,
  runWorkflowCallback: ((workflowId: string) => Promise<unknown>) | undefined,
  command: AxCommand,
): Promise<AxWorkflowCommandResult> {
  const parsed = AxWorkflowRunArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  if (!store.getWorkflow(parsed.data.workflowId)) {
    return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'args.workflowId')]];
  }
  if (!runWorkflowCallback) {
    return ['error', undefined, [issue('workflow_runner_unavailable', 'workflow 실행기가 연결되지 않았습니다.')]];
  }
  try {
    return ['ok', await runWorkflowCallback(parsed.data.workflowId)];
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'workflow_run_failed';
    return ['error', undefined, [issue(code, error instanceof Error ? error.message : String(error))]];
  }
}

function inspectWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const workflowId = textArg(command, 'workflowId');
  if (!workflowId) {
    return ['invalid', undefined, [issue('missing_argument', 'workflowId가 필요합니다.', 'args.workflowId')]];
  }
  const workflow = store.getWorkflow(workflowId);
  if (!workflow) {
    return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${workflowId}`, 'args.workflowId')]];
  }
  const validation = validateIR(store, workflow);
  return [validation.status, { workflow, validation: validation.data }, validation.issues];
}

function validateWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const workflowId = textArg(command, 'workflowId');
  if (!workflowId) {
    return ['invalid', undefined, [issue('missing_argument', 'workflowId가 필요합니다.', 'args.workflowId')]];
  }
  const workflow = store.getWorkflow(workflowId);
  if (!workflow) {
    return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${workflowId}`, 'args.workflowId')]];
  }
  const validation = validateIR(store, workflow);
  return [validation.status, validation.data, validation.issues];
}

function createWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const candidate = candidateFromCreateCommand(command, AxWorkflowCreateArgsSchema);
  if (!candidate.ok) return candidate.result;
  return persistCandidate(store, command.name, candidate.value, 'created');
}

async function enqueueOnce(
  store: WorkflowStore,
  enqueueCallback: ((workflow: WorkflowIR) => Promise<unknown> | unknown) | undefined,
  command: AxCommand,
): Promise<AxWorkflowCommandResult> {
  const candidate = candidateFromCreateCommand(command, AxExecutionEnqueueOnceArgsSchema);
  if (!candidate.ok) return candidate.result;
  if (!enqueueCallback) {
    return ['error', undefined, [issue('ephemeral_runner_unavailable', '일회 실행 큐가 연결되지 않았습니다.')]];
  }

  const validation = validateIR(store, candidate.value);
  if (validation.status !== 'ok') {
    return [validation.status, { queued: false, validation: validation.data }, validation.issues];
  }

  try {
    const queued = await enqueueCallback(candidate.value);
    return ['queued', { ...asRecord(queued), queued: true, ephemeral: true }];
  } catch (error) {
    return ['error', undefined, [issue('ephemeral_enqueue_failed', error instanceof Error ? error.message : String(error))]];
  }
}

function candidateFromCreateCommand(
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

function updateWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const parsed = AxWorkflowUpdateArgsSchema.safeParse(command.args);
  if (!parsed.success) {
    return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  }

  const current = store.getWorkflow(parsed.data.workflowId);
  if (!current) {
    return [
      'not_found',
      undefined,
      [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')],
    ];
  }
  if (current.version !== parsed.data.baseVersion) {
    return [
      'conflict',
      { currentVersion: current.version },
      [issue('stale_workflow_version', `workflow가 ${current.version} 버전으로 변경되었습니다. 최신 버전을 다시 조회해야 합니다.`, 'baseVersion')],
    ];
  }

  const next: WorkflowIR = {
    ...current,
    steps: [...current.steps],
    assumptions: [...current.assumptions],
    sideEffects: { ...current.sideEffects },
  };
  const operationIssues: AxCommandIssue[] = [];

  for (const operation of parsed.data.operations) {
    if (operation.op === 'set') {
      const applied = applyWorkflowField(next, operation.path, operation.value);
      if (!applied.ok) operationIssues.push(applied.issue);
      continue;
    }
    if (operation.op === 'remove_step') {
      const index = next.steps.findIndex((step) => step.id === operation.stepId);
      if (index < 0) {
        operationIssues.push(issue('step_not_found', `step을 찾을 수 없습니다: ${operation.stepId}`, `steps.${operation.stepId}`));
        continue;
      }
      next.steps.splice(index, 1);
      delete next.sideEffects[operation.stepId];
      continue;
    }

    const normalized = normalizeStepInput(operation.step);
    if (!normalized.ok) {
      operationIssues.push(...normalized.issues);
      continue;
    }
    const index = next.steps.findIndex((step) => step.id === normalized.value.id);
    if (index < 0) next.steps.push(normalized.value);
    else next.steps[index] = normalized.value;
    if (normalized.value.type === 'action') next.sideEffects[normalized.value.id] = normalized.value.sideEffect;
    else delete next.sideEffects[normalized.value.id];
  }

  if (operationIssues.length > 0) return ['invalid', undefined, operationIssues];
  return persistCandidate(store, command.name, next, 'updated');
}

function deleteWorkflow(store: WorkflowStore, command: AxCommand): AxWorkflowCommandResult {
  const parsed = AxWorkflowDeleteArgsSchema.safeParse(command.args);
  if (!parsed.success) {
    return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  }
  const current = store.getWorkflow(parsed.data.workflowId);
  if (!current) {
    return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')]];
  }
  if (current.version !== parsed.data.baseVersion) {
    return ['conflict', { currentVersion: current.version }, [issue('stale_workflow_version', '최신 workflow 버전과 일치하지 않습니다.', 'baseVersion')]];
  }
  const deleted = store.deleteWorkflow(parsed.data.workflowId);
  return deleted
    ? ['ok', { workflowId: parsed.data.workflowId, deleted: true }]
    : ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')]];
}

function persistCandidate(
  store: WorkflowStore,
  command: AxCommandName,
  candidate: WorkflowIR,
  operation: 'created' | 'updated',
): AxWorkflowCommandResult {
  const parsed = validateWorkflowIR(candidate);
  if (!parsed.ok) return ['invalid', undefined, [issue('invalid_workflow_schema', parsed.error)]];
  try {
    const saved = store.saveWorkflow(parseWorkflowIR(parsed.value));
    const workflow = store.getWorkflow(saved.workflowId, saved.version);
    return ['ok', { operation, workflowId: saved.workflowId, version: saved.version, workflow }];
  } catch (error) {
    const contractIssues = (error as { issues?: ContractValidationIssue[] }).issues;
    if (Array.isArray(contractIssues)) {
      const issues = contractIssues.map(mapContractIssue);
      return [statusForValidation(contractIssues), { saved: false }, issues];
    }
    return ['error', undefined, [issue('workflow_persist_failed', error instanceof Error ? error.message : String(error))]];
  }
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

function normalizeStepInput(input: unknown):
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
      sideEffect: capability.sideEffect ?? 'EXTERNAL',
    },
  };
}

function validateIR(store: WorkflowStore, workflow: Parameters<typeof validateWorkflowContracts>[0]) {
  const schema = validateWorkflowIR(workflow);
  if (!schema.ok) {
    const issues = [issue('invalid_workflow_schema', schema.error)];
    return { status: 'invalid' as const, data: { valid: false, issues }, issues };
  }
  const connectedConnectors = store
    .getConnections()
    .filter((entry) => entry.connected)
    .map((entry) => entry.connector);
  const contractIssues = validateWorkflowContracts(schema.value, { connectedConnectors });
  const issues = contractIssues.map(mapContractIssue);
  return { status: statusForValidation(contractIssues), data: { valid: contractIssues.length === 0, issues }, issues };
}

function sideEffectsFor(steps: Step[]): Record<string, WorkflowIR['sideEffects'][string]> {
  return Object.fromEntries(
    steps
      .filter((step): step is Extract<Step, { type: 'action' }> => step.type === 'action')
      .map((step) => [step.id, step.sideEffect]),
  );
}

function applyWorkflowField(
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

function textArg(command: AxCommand, name: string): string | undefined {
  const value = command.args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function issue(code: string, message: string, path?: string): AxCommandIssue {
  return { code, message, ...(path ? { path } : {}) };
}

function statusForValidation(issues: ContractValidationIssue[]): AxCommandResult['status'] {
  if (issues.length === 0) return 'ok';
  return issues.every((entry) => entry.code === 'missing_input_contract' || entry.code === 'connector_unavailable')
    ? 'needs_input'
    : 'invalid';
}

function mapContractIssue(entry: ContractValidationIssue): AxCommandIssue {
  return {
    code: entry.code,
    ...(entry.stepId ? { path: `steps.${entry.stepId}` } : {}),
    message: entry.message,
    ...(entry.expected ? { expected: entry.expected } : {}),
    ...(entry.available ? { available: entry.available } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

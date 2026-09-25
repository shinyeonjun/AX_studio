import {
  validateWorkflowContracts,
  type ContractValidationIssue,
} from '../../../../../workflow/contract-validator.js';
import {
  validateWorkflowIR,
  type WorkflowIR,
} from '../../../../../workflow/schema.js';
import { randomUUID } from 'node:crypto';
import type { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { AxWorkflowCreateArgsSchema } from '../../schema/workflow-args.js';
import type { AxCommand } from '../../schema.js';
import { candidateFromCreateCommand } from '../../workflow-gateway/steps.js';
import {
  confirmationPresentation,
  workflowConfirmationPresentation,
} from '../presentation.js';
import {
  compileScheduledHttpSlackJob,
} from '../compile.js';
import {
  mapContractIssue,
  issue,
} from '../shared.js';
import type { PendingJobDraft } from '../contract.js';
import type { ProposeResponse, ValidatedProposeInput } from './contracts.js';
import type { SelectedJobTargets } from './target-selection.js';

export function createPendingJob(options: {
  store: WorkflowStore;
  pending: Map<string, PendingJobDraft>;
  input: ValidatedProposeInput;
  targets?: SelectedJobTargets;
}): ProposeResponse {
  const { store, pending, input, targets } = options;
  if (input.genericWorkflow) return createPendingGenericJob(store, pending, input);
  if (!targets) return ['invalid', undefined, [issue('job_targets_required', 'HTTP 업무 대상이 없습니다.')]];
  const { data, sessionId, path, cron, timezone } = input;
  if (!pending.has(sessionId) && pending.size >= 128) {
    return ['invalid', undefined, [issue('pending_jobs_full', '미완료 업무 초안이 많습니다. 기존 초안을 저장하거나 해당 대화를 정리한 뒤 다시 시도해 주세요.')]];
  }
  const connected = store.getConnections().filter((entry) => entry.connected).map((entry) => entry.connector);
  const spec = {
    name: data.name,
    goal: data.goal,
    cron,
    timezone,
    path,
    connectionId: targets.endpoint.id,
    httpLabel: targets.endpoint.label || targets.endpoint.baseUrl,
    headers: data.fetch?.headers,
    interpretGoal: data.interpret?.goal?.trim() || data.goal,
    channel: targets.channel,
    skipIfEmpty: data.notify?.skipIfEmpty ?? true,
    runOnceNow: data.runOnceNow,
    allowExternalAuto: data.allowExternalAuto,
  };

  let ir: WorkflowIR;
  try {
    ir = compileScheduledHttpSlackJob(spec);
  } catch {
    return ['invalid', undefined, [issue('invalid_workflow_schema', '업무를 워크플로 형식으로 변환하지 못했습니다. 입력 값을 확인해 주세요.')]];
  }

  const schema = validateWorkflowIR(ir);
  if (!schema.ok) {
    return ['invalid', undefined, [issue('invalid_workflow_schema', '업무를 워크플로 형식으로 변환하지 못했습니다. 입력 값을 확인해 주세요.')]];
  }
  const contractIssues: ContractValidationIssue[] = validateWorkflowContracts(schema.value, { connectedConnectors: connected });
  if (contractIssues.length > 0) {
    return ['invalid', { saved: false }, contractIssues.map(mapContractIssue)];
  }

  const confirmationToken = randomUUID();
  pending.set(sessionId, { spec, ir, confirmationToken });
  const presentation = confirmationPresentation(spec, spec.httpLabel, confirmationToken);
  return ['ok', {
    saved: false,
    pending: true,
    presentation,
    message: spec.name + ' 초안을 확인한 뒤 저장할 수 있습니다.',
    summary: {
      name: spec.name,
      schedule: spec.cron,
      timezone: spec.timezone,
      path: spec.path,
      connectionId: spec.connectionId,
      httpLabel: spec.httpLabel,
      channel: spec.channel,
      runOnceNow: spec.runOnceNow,
      allowExternalAuto: spec.allowExternalAuto,
    },
  }];
}

function createPendingGenericJob(
  store: WorkflowStore,
  pending: Map<string, PendingJobDraft>,
  input: ValidatedProposeInput,
): ProposeResponse {
  const { data, sessionId } = input;
  if (!data.trigger || !data.steps) {
    return ['invalid', undefined, [issue('workflow_payload_required', 'trigger와 steps가 필요합니다.')]];
  }
  if (!pending.has(sessionId) && pending.size >= 128) {
    return ['invalid', undefined, [issue('pending_jobs_full', '미완료 업무 초안이 많습니다. 기존 초안을 저장하거나 해당 대화를 정리한 뒤 다시 시도해 주세요.')]];
  }

  const candidate = candidateFromCreateCommand({
    name: 'workflow.create',
    args: {
      name: data.name,
      goal: data.goal,
      trigger: data.trigger,
      steps: data.steps,
      success: data.success,
      assumptions: data.assumptions ?? [],
    },
  } as AxCommand, AxWorkflowCreateArgsSchema);
  if (!candidate.ok) return candidate.result as ProposeResponse;

  const parsed = validateWorkflowIR({
    ...candidate.value,
    allowExternalAuto: data.allowExternalAuto,
  });
  if (!parsed.ok) {
    return ['invalid', undefined, [issue('invalid_workflow_schema', parsed.error)]];
  }
  const connected = store.getConnections().filter((entry) => entry.connected).map((entry) => entry.connector);
  const contractIssues: ContractValidationIssue[] = validateWorkflowContracts(parsed.value, { connectedConnectors: connected });
  if (contractIssues.length > 0) {
    return ['invalid', { saved: false }, contractIssues.map(mapContractIssue)];
  }

  const confirmationToken = randomUUID();
  pending.set(sessionId, {
    spec: { name: data.name, runOnceNow: data.runOnceNow },
    ir: parsed.value,
    confirmationToken,
  });
  return ['ok', {
    saved: false,
    pending: true,
    presentation: workflowConfirmationPresentation(
      parsed.value,
      data.runOnceNow,
      data.allowExternalAuto,
      confirmationToken,
    ),
    message: data.name + ' 초안을 확인한 뒤 저장할 수 있습니다.',
    summary: {
      name: data.name,
      trigger: parsed.value.trigger,
      steps: parsed.value.steps.map((step) => step.id),
      runOnceNow: data.runOnceNow,
      allowExternalAuto: data.allowExternalAuto,
    },
  }];
}

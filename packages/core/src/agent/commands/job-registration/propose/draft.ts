import {
  validateWorkflowContracts,
  type ContractValidationIssue,
} from '../../../../workflow/contract-validator.js';
import {
  validateWorkflowIR,
  type WorkflowIR,
} from '../../../../workflow/schema.js';
import type { WorkflowStore } from '../../../../store/workflow-store.js';
import {
  confirmationPresentation,
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
  targets: SelectedJobTargets;
}): ProposeResponse {
  const { store, pending, input, targets } = options;
  const { data, sessionId, path, cron, timezone } = input;
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

  pending.set(sessionId, { spec, ir });
  const presentation = confirmationPresentation(spec, spec.httpLabel);
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

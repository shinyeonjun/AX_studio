import {
  validateWorkflowContracts,
} from '../../../workflow/contract-validator.js';
import type { WorkflowStore } from '../../../store/workflow-store.js';
import type {
  AxCommandIssue,
  AxCommandResult,
} from '../schema.js';
import type { PendingJobDraft } from './contract.js';
import {
  connectedIds,
} from './targets.js';
import {
  issue,
} from './shared.js';

export async function commitJob(options: {
  store: WorkflowStore;
  pending: Map<string, PendingJobDraft>;
  workspaceSessionId?: string;
  allowJobCommit?: boolean;
  runWorkflow?: (workflowId: string) => Promise<unknown>;
}): Promise<[AxCommandResult['status'], unknown, AxCommandIssue[]?]> {
  if (!options.allowJobCommit) {
    return ['forbidden', undefined, [issue('job_commit_forbidden', '업무 저장은 확인 카드의 host 확인 이후에만 가능합니다.')]];
  }

  const sessionId = options.workspaceSessionId?.trim();
  if (!sessionId) {
    return ['invalid', undefined, [issue('workspace_session_required', '이 업무를 저장하려면 현재 대화 세션이 필요합니다.')]];
  }

  const draft = options.pending.get(sessionId);
  if (!draft) {
    return ['not_found', undefined, [issue('pending_job_not_found', '저장할 업무 초안이 없습니다. 먼저 업무를 다시 제안해 주세요.')]];
  }

  const connected = connectedIds(options.store);
  const contractIssues = validateWorkflowContracts(draft.ir, { connectedConnectors: connected });
  if (contractIssues.length > 0) {
    return ['invalid', { saved: false }, contractIssues.map((entry) => issue(entry.code, entry.message, entry.stepId))];
  }

  try {
    const saved = options.store.saveWorkflow(draft.ir);
    // Drop the draft as soon as the workflow exists so a failure in any later
    // step cannot leave a stale draft that would save a duplicate on retry.
    options.pending.delete(sessionId);
    options.store.setWorkflowActive(saved.workflowId, true);
    const chat = options.store.getWorkspaceChat(sessionId);
    if (chat) {
      options.store.saveWorkspaceChat({
        id: sessionId,
        messages: chat.messages,
        workflowId: saved.workflowId,
      });
    }

    let run: unknown;
    let runError: string | undefined;
    if (draft.spec.runOnceNow) {
      if (!options.runWorkflow) {
        runError = '지금 실행기는 연결되지 않았습니다. 스케줄은 켜져 있습니다.';
      } else {
        try {
          run = await options.runWorkflow(saved.workflowId);
        } catch (error) {
          runError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    const message = runError
      ? draft.spec.name + ' 업무를 저장하고 스케줄을 켰습니다. 지금 실행은 실패했으니 실행 기록에서 원인을 확인해 주세요.'
      : draft.spec.runOnceNow
        ? draft.spec.name + ' 업무를 저장하고 스케줄을 켰습니다. 지금 한 번 실행을 시작했습니다.'
        : draft.spec.name + ' 업무를 저장하고 스케줄을 켰습니다.';

    return ['ok', {
      operation: 'created',
      workflowId: saved.workflowId,
      version: saved.version,
      active: true,
      runOnceNow: draft.spec.runOnceNow,
      ...(run === undefined ? {} : { run }),
      ...(runError ? { runError } : {}),
      message,
    }];
  } catch (error) {
    const contract = (error as { issues?: Array<{ code: string; message: string; stepId?: string }> }).issues;
    if (Array.isArray(contract)) {
      return ['invalid', { saved: false }, contract.map((entry) => issue(entry.code, entry.message, entry.stepId))];
    }
    return ['error', undefined, [issue('workflow_persist_failed', error instanceof Error ? error.message : String(error))]];
  }
}

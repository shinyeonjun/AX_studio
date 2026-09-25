import {
  AxExecutionEnqueueOnceArgsSchema,
  type AxCommand,
} from '../schema.js';
import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import type {
  AxEnqueueOnceOptions,
  AxWorkflowCommandResult,
} from './contract.js';
import { targetSelectionPresentation } from '../job-registration/presentation.js';
import { candidateFromCreateCommand } from './steps.js';
import { oneShotTargetInputs } from './targets.js';
import {
  asRecord,
  issue,
  validateIR,
} from './validation.js';

export async function enqueueOnce(
  store: WorkflowStore,
  enqueueCallback: ((workflow: WorkflowIR, options?: { workspaceSessionId?: string }) => Promise<unknown> | unknown) | undefined,
  command: AxCommand,
  options: AxEnqueueOnceOptions = {},
): Promise<AxWorkflowCommandResult> {
  const candidate = candidateFromCreateCommand(command, AxExecutionEnqueueOnceArgsSchema);
  if (!candidate.ok) return candidate.result;
  if (!enqueueCallback) {
    return ['error', undefined, [issue('ephemeral_runner_unavailable', '일회 실행 큐가 연결되지 않았습니다.')]];
  }

  const targetInputs = await oneShotTargetInputs(store, candidate.value, options.listSlackChannels);
  if (targetInputs.length > 0) {
    return [
      'needs_input',
      {
        queued: false,
        pending: true,
        message: '조회와 외부 공유에 사용할 연결과 채널을 선택해 주세요. 선택을 마치기 전까지 작업은 큐에 등록되지 않습니다.',
        presentation: targetSelectionPresentation(targetInputs, {
          actionId: 'review_execution_targets',
          actionLabel: '선택하고 실행안 검토',
          actionValue: '선택한 연결과 채널로 실행안을 검토해줘',
        }),
      },
      [issue('execution_targets_required', '일회 실행에 사용할 연결과 공유 채널을 먼저 선택해야 합니다.', undefined, targetInputs)],
    ];
  }

  const validation = validateIR(store, candidate.value);
  if (validation.status !== 'ok') {
    const data = validation.status === 'needs_input'
      ? { queued: false, message: '실행에 필요한 정보를 입력해 주세요. 입력이 완료되기 전에는 작업이 큐에 등록되지 않습니다.', validation: validation.data }
      : { queued: false, validation: validation.data };
    return [validation.status, data, validation.issues];
  }

  try {
    const queued = await enqueueCallback(candidate.value, {
      workspaceSessionId: options.workspaceSessionId,
    });
    return ['queued', { ...asRecord(queued), queued: true, ephemeral: true }];
  } catch (error) {
    return ['error', undefined, [issue('ephemeral_enqueue_failed', error instanceof Error ? error.message : String(error))]];
  }
}

import type {
  AxInputRequest,
  AxUiPresentation,
} from '../schema.js';
import {
  JOB_COMMIT_CONFIRM_VALUE,
  type NormalizedJobSpec,
} from './contract.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';

export function targetSelectionPresentation(
  inputs: AxInputRequest[],
  options: {
    actionId?: string;
    actionLabel?: string;
    actionValue?: string;
    note?: string;
  } = {},
): AxUiPresentation {
  return {
    title: '공유 대상 선택',
    subtitle: '조회와 공유에 사용할 대상을 한 번에 선택해 주세요.',
    inputMode: 'batch',
    blocks: [{
      type: 'note',
      text: options.note ?? '선택 후 조회·요약한 공유안을 먼저 보여드립니다. 실제 외부 발송은 별도 승인 전까지 실행하지 않습니다.',
    }],
    inputs,
    actions: [{
      id: options.actionId ?? 'review_job_targets',
      label: options.actionLabel ?? '선택하고 공유안 검토',
      value: options.actionValue ?? '선택한 연결과 채널로 공유안을 검토해줘',
      tone: 'primary',
      purpose: 'reply',
    }],
  };
}

export function confirmationPresentation(spec: NormalizedJobSpec, httpLabel?: string): AxUiPresentation {
  const autoNote = spec.allowExternalAuto
    ? '확인하면 이후 스케줄 실행에서 Slack 발송을 매번 승인하지 않습니다.'
    : '확인해도 이후 Slack 발송은 실행마다 승인이 필요합니다.';
  const runNote = spec.runOnceNow ? '저장 직후 한 번 실행합니다.' : '지금은 실행하지 않고 스케줄만 켭니다.';
  return {
    title: '이 업무를 저장할까요?',
    subtitle: spec.name,
    inputMode: 'individual',
    blocks: [
      {
        type: 'steps',
        title: '등록 내용',
        items: [
          `스케줄: ${spec.cron} (${spec.timezone})`,
          `HTTP GET: ${spec.path}${httpLabel ? ` (${httpLabel})` : ''}`,
          `Slack: ${spec.channel}`,
          runNote,
        ],
      },
      { type: 'note', text: autoNote },
    ],
    inputs: [],
    actions: [
      {
        id: 'confirm_job',
        label: '저장하고 켜기',
        value: JOB_COMMIT_CONFIRM_VALUE,
        tone: 'primary',
        purpose: 'confirm_job',
      },
    ],
  };
}

function triggerSummary(trigger: WorkflowIR['trigger']): string {
  if (!trigger) return '수동 시작';
  if (trigger.type === 'schedule') return `스케줄: ${trigger.schedule} (${trigger.timezone})`;
  if (trigger.type === 'gmail.new_message') return `Gmail 새 메일: ${trigger.accountId}`;
  if (trigger.type === 'slack.new_message') return `Slack 새 메시지: ${trigger.channel}`;
  if (trigger.type === 'local_folder.new_file') return `폴더 새 파일: ${trigger.folderId}`;
  if (trigger.type === 'once') return `일회 실행: ${trigger.runAt}`;
  if (trigger.type === 'webhook.inbound') return `Webhook: ${trigger.path}`;
  return '수동 시작';
}

export function workflowConfirmationPresentation(
  workflow: WorkflowIR,
  runOnceNow: boolean,
  allowExternalAuto: boolean,
): AxUiPresentation {
  const autoNote = allowExternalAuto
    ? '확인하면 이후 외부 발송 단계가 매번 승인 없이 실행될 수 있습니다.'
    : '확인해도 외부 발송 단계는 실행마다 승인이 필요합니다.';
  return {
    title: '이 업무를 저장할까요?',
    subtitle: workflow.name,
    inputMode: 'individual',
    blocks: [
      {
        type: 'steps',
        title: '등록 내용',
        items: [
          triggerSummary(workflow.trigger),
          `단계: ${workflow.steps.map((step) => step.id).join(' → ')}`,
          runOnceNow ? '저장 직후 한 번 실행합니다.' : '지금은 실행하지 않고 시작 조건만 저장합니다.',
        ],
      },
      { type: 'note', text: autoNote },
    ],
    inputs: [],
    actions: [{
      id: 'confirm_job',
      label: '저장하고 켜기',
      value: JOB_COMMIT_CONFIRM_VALUE,
      tone: 'primary',
      purpose: 'confirm_job',
    }],
  };
}

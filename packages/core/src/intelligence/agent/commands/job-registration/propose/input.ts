import { verifyAuthoritativeRequestAnchor } from '../../../../decision/request-anchor.js';
import { isValidCronExpression, isValidTimeZone } from '../../../../../workflow/cron.js';
import type { AxCommandIssue, AxCommandResult } from '../../schema.js';
import {
  AxJobProposeArgsSchema,
  DEFAULT_JOB_CRON,
  DEFAULT_JOB_TIMEZONE,
  coerceJobProposeArgs,
  type AxJobProposeArgs,
} from '../contract.js';
import { issue, missingInput } from '../shared.js';
import type { ProposeResponse, ValidatedProposeInput } from './contracts.js';

export type ProposeInputResult =
  | { ok: true; value: ValidatedProposeInput }
  | { ok: false; response: ProposeResponse };

export function validateProposeInput(
  args: unknown,
  workspaceSessionId?: string,
): ProposeInputResult {
  const parsed = AxJobProposeArgsSchema.safeParse(coerceJobProposeArgs(args));
  if (!parsed.success) {
    const response: [AxCommandResult['status'], unknown, AxCommandIssue[]] = [
      'invalid',
      { message: '업무 초안 형식이 올바르지 않습니다. 이름, 목표, HTTP 경로, Slack 채널을 다시 보내 주세요.' },
      [issue('invalid_arguments', '업무 초안 형식이 올바르지 않습니다.')],
    ];
    return { ok: false, response };
  }

  const sessionId = workspaceSessionId?.trim();
  if (!sessionId) {
    return {
      ok: false,
      response: ['invalid', undefined, [issue('workspace_session_required', '이 업무는 대화 안에서 요청해야 등록할 수 있습니다.')]],
    };
  }

  const data: AxJobProposeArgs = parsed.data;
  if (data.requestAnchor) {
    try {
      data.requestAnchor = verifyAuthoritativeRequestAnchor(data.requestAnchor);
      data.goal = data.requestAnchor.text;
    } catch {
      return { ok: false, response: ['invalid', undefined, [issue('request_anchor_mismatch', '요청 원문을 확인하지 못했습니다.')]] };
    }
  }
  const genericWorkflow = data.trigger !== undefined || data.steps !== undefined;
  if (genericWorkflow && (!data.trigger || !data.steps || data.steps.length === 0)) {
    return {
      ok: false,
      response: ['needs_input', undefined, [issue(
        'workflow_payload_required',
        '반복 업무는 언제 시작할지와 무엇을 할지가 함께 있어야 합니다. "매주 월요일 오전 9시에 보고서를 메일로 보내 줘"처럼 다시 알려 주세요.',
        'args.steps',
      )]],
    };
  }
  const path = data.fetch?.path?.trim() ?? '';
  const channel = data.notify?.channel?.trim() ?? '';
  if (!path && !genericWorkflow) {
    return {
      ok: false,
      response: missingInput([{
        id: 'job-http-path',
        label: '가져올 데이터 주소',
        type: 'text',
        required: true,
        placeholder: '예: /orders',
        reason: '연결한 서비스에서 어떤 데이터를 가져올지 주소를 입력해 주세요.',
      }], '어떤 데이터를 가져올지 아직 정해지지 않았습니다. 연결한 서비스에서 가져올 데이터 주소를 알려 주세요.', 'args.fetch.path'),
    };
  }

  const cron = data.schedule?.cron?.trim() || DEFAULT_JOB_CRON;
  const timezone = data.schedule?.timezone?.trim() || DEFAULT_JOB_TIMEZONE;
  if (!isValidCronExpression(cron)) {
    return {
      ok: false,
      response: ['invalid', undefined, [issue('invalid_schedule', '반복 일정을 이해하지 못했습니다. "매주 월요일 오전 9시"처럼 다시 알려 주세요.', 'args.schedule.cron')]],
    };
  }
  if (!isValidTimeZone(timezone)) {
    return {
      ok: false,
      response: ['invalid', undefined, [issue('invalid_schedule', '시간대를 이해하지 못했습니다. "한국 시간"처럼 다시 알려 주세요.', 'args.schedule.timezone')]],
    };
  }

  return {
    ok: true,
    value: { data, sessionId, genericWorkflow, path, channel, cron, timezone },
  };
}

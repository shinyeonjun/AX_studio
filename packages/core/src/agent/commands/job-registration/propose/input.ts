import { isValidCronExpression, isValidTimeZone } from '../../../../workflow/cron.js';
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
      response: ['invalid', undefined, [issue('workspace_session_required', '이 업무를 등록하려면 현재 대화 세션이 필요합니다.')]],
    };
  }

  const data: AxJobProposeArgs = parsed.data;
  const path = data.fetch?.path?.trim() ?? '';
  const channel = data.notify?.channel?.trim() ?? '';
  if (!path) {
    return {
      ok: false,
      response: missingInput([{
        id: 'job-http-path',
        label: 'HTTP 조회 경로',
        type: 'text',
        required: true,
        placeholder: '/api/v1/…',
        reason: '연결한 HTTP의 상대 경로를 입력해 주세요.',
      }], 'HTTP 조회 경로가 필요합니다. 연결한 HTTP의 상대 경로를 보내 주세요.', 'args.fetch.path'),
    };
  }

  const cron = data.schedule?.cron?.trim() || DEFAULT_JOB_CRON;
  const timezone = data.schedule?.timezone?.trim() || DEFAULT_JOB_TIMEZONE;
  if (!isValidCronExpression(cron)) {
    return {
      ok: false,
      response: ['invalid', undefined, [issue('invalid_schedule', 'cron 표현식이 올바르지 않습니다: ' + cron, 'args.schedule.cron')]],
    };
  }
  if (!isValidTimeZone(timezone)) {
    return {
      ok: false,
      response: ['invalid', undefined, [issue('invalid_schedule', 'timezone이 올바르지 않습니다: ' + timezone, 'args.schedule.timezone')]],
    };
  }

  return {
    ok: true,
    value: { data, sessionId, path, channel, cron, timezone },
  };
}

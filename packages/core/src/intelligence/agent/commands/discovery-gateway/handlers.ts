import { WorkDiscoveryService } from '../../../../work-discovery/service.js';
import {
  DiscoveryAnswerArgsSchema,
  DiscoveryPublishArgsSchema,
  DiscoveryRetryArgsSchema,
  DiscoveryStartArgsSchema,
} from '../../../../work-discovery/schema.js';
import type { AxCommand } from '../schema.js';
import type { DiscoveryCommandResult } from './contracts.js';
import { issue, sessionInput } from './shared.js';

export function start(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const parsed = DiscoveryStartArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const started = service.start(parsed.data);
  return ['ok', { sessionId: started.id, status: started.state }];
}

export function inspect(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const sessionId = typeof command.args.sessionId === 'string' ? command.args.sessionId : '';
  if (!sessionId.trim()) return ['invalid', undefined, [issue('missing_argument', '어떤 업무 찾기를 확인할지 알려 주세요.', 'args.sessionId', [sessionInput()])]];
  const view = service.inspect(sessionId.trim());
  if (!view) return ['not_found', undefined, [issue('discovery_not_found', '진행 중인 업무 찾기를 찾지 못했어요. 처음부터 다시 요청해 주세요.')]];
  return ['ok', view];
}

export function cancel(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const sessionId = typeof command.args.sessionId === 'string' ? command.args.sessionId : '';
  if (!sessionId.trim()) return ['invalid', undefined, [issue('missing_argument', '어떤 업무 찾기를 확인할지 알려 주세요.', 'args.sessionId', [sessionInput()])]];
  const session = service.cancel(sessionId.trim());
  if (!session) return ['not_found', undefined, [issue('discovery_not_found', '진행 중인 업무 찾기를 찾지 못했어요. 처음부터 다시 요청해 주세요.')]];
  return ['ok', { sessionId: session.id, status: session.status }];
}

export function retry(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const parsed = DiscoveryRetryArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const session = service.retry(parsed.data.sessionId, parsed.data.expectedRevision);
  if ('error' in session) {
    if (session.error === 'discovery_revision_conflict' && 'currentRevision' in session) {
      return [
        'conflict',
        { currentRevision: session.currentRevision },
        [issue(session.error, '그사이 진행 상황이 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.', 'expectedRevision')],
      ];
    }
    if (session.error === 'discovery_not_found') {
      return ['not_found', undefined, [issue(session.error, '진행 중인 업무 찾기를 찾지 못했어요. 처음부터 다시 요청해 주세요.')]];
    }
    return ['invalid', undefined, [issue(session.error, '지금은 다시 시도할 수 없어요. 처음부터 다시 요청해 주세요.')]];
  }
  return ['ok', { sessionId: session.id, status: session.status, revision: session.revision }];
}

export function answer(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const parsed = DiscoveryAnswerArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const session = service.answer(
    parsed.data.sessionId,
    parsed.data.questionId,
    parsed.data.optionId,
    parsed.data.expectedRevision,
  );
  if (!session) return ['not_found', undefined, [issue('discovery_not_found', '진행 중인 업무 찾기를 찾지 못했어요. 처음부터 다시 요청해 주세요.')]];
  if ('error' in session) {
    return [
      'conflict',
      { currentRevision: session.currentRevision },
      [issue(session.error, '그사이 진행 상황이 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.', 'expectedRevision')],
    ];
  }
  return ['ok', { sessionId: session.id, status: session.status, revision: session.revision }];
}

export function publish(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const parsed = DiscoveryPublishArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const result = service.publish(parsed.data.sessionId, parsed.data.name, parsed.data.expectedRevision, parsed.data.schedule);
  if ('error' in result) {
    if (result.error === 'discovery_revision_conflict' && 'currentRevision' in result) {
      return [
        'conflict',
        { currentRevision: result.currentRevision },
        [issue(result.error, '그사이 진행 상황이 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.', 'expectedRevision')],
      ];
    }
    if (result.error === 'invalid_schedule') {
      return ['invalid', undefined, [issue(result.error, '반복 일정을 이해하지 못했습니다. 일정을 다시 골라 주세요.', 'schedule')]];
    }
    return ['invalid', undefined, [issue(result.error, '업무를 저장할 수 없습니다.')]];
  }
  return ['ok', { workflowId: result.workflowId }];
}

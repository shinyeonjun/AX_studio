import type { AxCommandDefinition, AxCommandLifecycle } from '../../schema.js';

export const DISCOVERY_COMMAND_DEFINITIONS = [
  {
    name: 'discovery.start',
    lifecycle: 'workflow',
    description: '지난 결과물 예시로 업무 발견을 시작합니다.',
    args: {
      goal: '업무 목표',
      exampleArtifactIds: 'artifact id list',
      inputArtifactIds: 'optional input artifacts',
      desiredRecurrence: 'optional cron schedule',
    },
    mutates: true,
  },
  {
    name: 'discovery.inspect',
    lifecycle: 'read',
    description: '업무 발견 세션 상태를 조회합니다.',
    args: { sessionId: 'discovery session id' },
    mutates: false,
  },
  {
    name: 'discovery.cancel',
    lifecycle: 'workflow',
    description: '진행 중인 업무 발견을 취소합니다.',
    args: { sessionId: 'discovery session id' },
    mutates: true,
  },
  {
    name: 'discovery.retry',
    lifecycle: 'workflow',
    description: '복구 확인이 필요한 업무 발견 세션을 마지막 안전 지점부터 다시 시도합니다.',
    args: { sessionId: 'discovery session id', expectedRevision: 'last inspected session revision' },
    mutates: true,
  },
  {
    name: 'discovery.answer',
    lifecycle: 'workflow',
    description: '모호한 후보에 대한 사용자 답변을 반영합니다.',
    args: {
      sessionId: 'discovery session id',
      questionId: 'question id',
      optionId: 'selected option id',
      expectedRevision: 'last inspected session revision',
    },
    mutates: true,
  },
  {
    name: 'discovery.publish',
    lifecycle: 'workflow',
    description: 'replay를 통과한 업무안을 workflow로 저장합니다.',
    args: { sessionId: 'discovery session id', name: 'optional workflow name', expectedRevision: 'last inspected session revision' },
    mutates: true,
  },
] as const satisfies readonly (AxCommandDefinition & { lifecycle: AxCommandLifecycle })[];

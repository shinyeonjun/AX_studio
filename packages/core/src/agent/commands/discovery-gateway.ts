import type { ArtifactStore } from '../../store/artifact-store.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import {
  WorkDiscoveryService,
} from '../../work-discovery/service.js';
import {
  DiscoveryAnswerArgsSchema,
  DiscoveryPublishArgsSchema,
  DiscoveryRetryArgsSchema,
  DiscoveryStartArgsSchema,
} from '../../work-discovery/schema.js';
import type { AxCommand, AxCommandIssue, AxCommandResult } from './schema.js';

export type DiscoveryCommandResult = [AxCommandResult['status'], unknown, AxCommandIssue[]?];

export interface DiscoveryCommandGateway {
  start(command: AxCommand): DiscoveryCommandResult;
  inspect(command: AxCommand): DiscoveryCommandResult;
  cancel(command: AxCommand): DiscoveryCommandResult;
  retry(command: AxCommand): DiscoveryCommandResult;
  answer(command: AxCommand): DiscoveryCommandResult;
  publish(command: AxCommand): DiscoveryCommandResult;
}

export interface DiscoveryGatewayOptions {
  artifactStore?: ArtifactStore;
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  snapshotDir?: string;
  sourceReadsMax?: number;
  autoResume?: boolean;
}

export function createDiscoveryCommandGateway(
  store: WorkflowStore,
  options: DiscoveryGatewayOptions = {},
): DiscoveryCommandGateway {
  const service = new WorkDiscoveryService({
    store,
    artifactStore: options.artifactStore,
    resolveConnectionConfig: options.resolveConnectionConfig,
    snapshotDir: options.snapshotDir,
    sourceReadsMax: options.sourceReadsMax,
    autoResume: options.autoResume,
  });
  return {
    start: (command) => start(service, command),
    inspect: (command) => inspect(service, command),
    cancel: (command) => cancel(service, command),
    retry: (command) => retry(service, command),
    answer: (command) => answer(service, command),
    publish: (command) => publish(service, command),
  };
}

function issue(code: string, message: string, path?: string): AxCommandIssue {
  return { code, message, path };
}

function start(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const parsed = DiscoveryStartArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const started = service.start(parsed.data);
  return ['ok', { sessionId: started.id, status: started.state }];
}

function inspect(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const sessionId = typeof command.args.sessionId === 'string' ? command.args.sessionId : '';
  if (!sessionId.trim()) return ['invalid', undefined, [issue('missing_argument', 'sessionId가 필요합니다.', 'args.sessionId')]];
  const view = service.inspect(sessionId.trim());
  if (!view) return ['not_found', undefined, [issue('discovery_not_found', `discovery session을 찾을 수 없습니다: ${sessionId}`)]];
  return ['ok', view];
}

function cancel(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const sessionId = typeof command.args.sessionId === 'string' ? command.args.sessionId : '';
  if (!sessionId.trim()) return ['invalid', undefined, [issue('missing_argument', 'sessionId가 필요합니다.', 'args.sessionId')]];
  const session = service.cancel(sessionId.trim());
  if (!session) return ['not_found', undefined, [issue('discovery_not_found', `discovery session을 찾을 수 없습니다: ${sessionId}`)]];
  return ['ok', { sessionId: session.id, status: session.status }];
}

function retry(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const parsed = DiscoveryRetryArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const session = service.retry(parsed.data.sessionId, parsed.data.expectedRevision);
  if ('error' in session) {
    if (session.error === 'discovery_revision_conflict' && 'currentRevision' in session) {
      return [
        'conflict',
        { currentRevision: session.currentRevision },
        [issue(session.error, '최신 discovery session 상태와 일치하지 않습니다.', 'expectedRevision')],
      ];
    }
    if (session.error === 'discovery_not_found') {
      return ['not_found', undefined, [issue(session.error, 'discovery session을 찾을 수 없습니다.')]];
    }
    return ['invalid', undefined, [issue(session.error, 'discovery session을 재시도할 수 없습니다.')]];
  }
  return ['ok', { sessionId: session.id, status: session.status, revision: session.revision }];
}

function answer(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const parsed = DiscoveryAnswerArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const session = service.answer(
    parsed.data.sessionId,
    parsed.data.questionId,
    parsed.data.optionId,
    parsed.data.expectedRevision,
  );
  if (!session) return ['not_found', undefined, [issue('discovery_not_found', 'discovery session을 찾을 수 없습니다.')]];
  if ('error' in session) {
    return [
      'conflict',
      { currentRevision: session.currentRevision },
      [issue(session.error, '최신 discovery session 상태와 일치하지 않습니다.', 'expectedRevision')],
    ];
  }
  return ['ok', { sessionId: session.id, status: session.status, revision: session.revision }];
}

function publish(service: WorkDiscoveryService, command: AxCommand): DiscoveryCommandResult {
  const parsed = DiscoveryPublishArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const result = service.publish(parsed.data.sessionId, parsed.data.name, parsed.data.expectedRevision);
  if ('error' in result) {
    if (result.error === 'discovery_revision_conflict' && 'currentRevision' in result) {
      return [
        'conflict',
        { currentRevision: result.currentRevision },
        [issue(result.error, '최신 discovery session 상태와 일치하지 않습니다.', 'expectedRevision')],
      ];
    }
    return ['invalid', undefined, [issue(result.error, '업무를 저장할 수 없습니다.')]];
  }
  return ['ok', { workflowId: result.workflowId }];
}

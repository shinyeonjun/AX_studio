import type { ConnectorContext } from '../../connectors/types.js';
import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { SideEffectLevel } from '../../workflow/schema.js';

export function recordExternalEffectAttempt(
  store: WorkflowStore,
  ctx: ConnectorContext,
  stepId: string,
  actionRef: string,
  sideEffect: SideEffectLevel,
): void {
  if (sideEffect !== 'EXTERNAL' && sideEffect !== 'EXTERNAL_HIGH') return;
  ctx.log({
    at: new Date().toISOString(), level: 'info', code: 'external_effect_started',
    message: '외부 작업 실행을 시작합니다. 이후 실패하면 처리 결과를 확인한 뒤 다시 실행해야 합니다.',
    data: { stepId, actionRef },
  });
  // A crash must not restore a pending approval that has already sent a request.
  // If persistence fails, the caller must not reach the external connector.
  store.flush();
}

export function hasAttemptedExternalEffect(result: unknown): boolean {
  const log = (result as { log?: unknown } | null)?.log;
  return Array.isArray(log) && log.some((entry) => entry?.code === 'external_effect_started');
}

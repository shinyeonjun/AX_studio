import { createAppApprovalActions } from './actions/approval-actions';
import { createAppSessionActions } from './actions/session-actions';
import { createAppWorkActions } from './actions/work-actions';
import type { AppActionContext, AppActions } from './actions/contracts';

export type { AppActions } from './actions/contracts';

export function retryFailedAppSources({
  stateFailed,
  sessionsFailed,
  detectionFailed,
  actionFailed,
  refresh,
  refreshSessions,
  refreshDetection,
}: {
  stateFailed: boolean;
  sessionsFailed: boolean;
  detectionFailed: boolean;
  actionFailed: boolean;
  refresh: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshDetection: () => Promise<unknown>;
}): void {
  if (stateFailed || actionFailed) void refresh();
  if (sessionsFailed || actionFailed) void refreshSessions();
  if (detectionFailed) void refreshDetection().catch(() => {});
}

export function createAppActions(context: AppActionContext): AppActions {
  const sessionActions = createAppSessionActions(context);
  const workActions = createAppWorkActions(context);
  const approvalActions = createAppApprovalActions(context);

  return {
    ...sessionActions,
    ...workActions,
    ...approvalActions,
  };
}

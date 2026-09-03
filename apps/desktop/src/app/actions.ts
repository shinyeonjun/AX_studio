import { createAppApprovalActions } from './actions/approval-actions';
import { createAppSessionActions } from './actions/session-actions';
import { createAppWorkActions } from './actions/work-actions';
import type { AppActionContext, AppActions } from './actions/contracts';

export type { AppActions } from './actions/contracts';

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

import { ipcErrorMessage } from '../../ui/lib/ipc-error';
import type { AppApprovalActionContext } from './contracts';

export function createAppApprovalActions({ refresh, setActionError }: AppApprovalActionContext) {
  // The approvals page shows a failure next to the request and refreshes afterwards itself, so a
  // failed refresh is never reported as a failed approval and the app banner stays clear.
  const handleApprove = async (id: string) => {
    setActionError('');
    await window.ax.approve(id);
  };

  const handleReject = async (id: string) => {
    setActionError('');
    await window.ax.reject(id);
  };

  const toggleWorkActive = async (workflowId: string, active: boolean) => {
    setActionError('');
    try {
      await window.ax.setWorkflowActive(workflowId, active);
      await refresh();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '업무 상태를 변경하지 못했습니다.'));
    }
  };

  const runWork = async (workflowId: string) => {
    setActionError('');
    try {
      const result = await window.ax.runWorkflow(workflowId);
      await refresh();
      if (result.status === 'failed') setActionError('업무를 실행했지만 실패했습니다. 활동 탭에서 이유를 확인해 주세요.');
    } catch (err) {
      setActionError(ipcErrorMessage(err, '업무를 실행하지 못했습니다.'));
    }
  };

  return { handleApprove, handleReject, toggleWorkActive, runWork };
}

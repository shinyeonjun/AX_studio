import { ipcErrorMessage } from '../../lib/ipc-error';
import type { AppApprovalActionContext } from './contracts';

export function createAppApprovalActions({ refresh, setActionError }: AppApprovalActionContext) {
  const handleApprove = async (id: string) => {
    setActionError('');
    try {
      await window.ax.approve(id);
      await refresh();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '승인에 실패했습니다.'));
      throw err;
    }
  };

  const handleReject = async (id: string) => {
    setActionError('');
    try {
      await window.ax.reject(id);
      await refresh();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '거절에 실패했습니다.'));
      throw err;
    }
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

  return { handleApprove, handleReject, toggleWorkActive };
}

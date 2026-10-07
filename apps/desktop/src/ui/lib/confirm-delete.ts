import { confirmed, requestConfirm } from './confirm-dialog';

/** Deleting a work stops it; its run and send history stays in 활동 unless the person also clears it. */
export async function confirmDeleteWork(name: string): Promise<{ confirmed: boolean; deleteHistory: boolean }> {
  const answer = await requestConfirm({
    title: `"${name}" 업무를 삭제할까요?`,
    message: '저장된 자동화 설정과 반복 일정이 삭제되어 더 이상 실행되지 않습니다. 이 업무를 만든 대화는 남습니다. 지금까지의 실행 기록(무엇을 보냈는지 포함)은 활동에 그대로 남습니다.',
    confirmLabel: '업무 삭제',
    danger: true,
    option: { label: '실행 기록도 함께 지우기' },
  });
  return { confirmed: answer.confirmed, deleteHistory: answer.optionChecked };
}

export function confirmDeleteChat(title: string): Promise<boolean> {
  return confirmed({
    title: `"${title}" 대화를 삭제할까요?`,
    message: '대화 기록만 지워지며 저장된 업무는 유지됩니다.',
    confirmLabel: '대화 삭제',
    danger: true,
  });
}

export function confirmDeleteExecution(): Promise<boolean> {
  return confirmed({ title: '이 실행 기록을 삭제할까요?', confirmLabel: '기록 삭제', danger: true });
}

export function confirmClearExecutions(count: number): Promise<boolean> {
  return confirmed({
    title: `실행 기록 ${count}건을 지울까요?`,
    message: '승인 대기 중인 실행은 남겨둡니다.',
    confirmLabel: '모두 지우기',
    danger: true,
  });
}

export function confirmDisconnectConnector(name: string): Promise<boolean> {
  return confirmed({
    title: `${name} 연결을 해제할까요?`,
    message: '이 연결을 사용하는 업무는 다음 실행부터 실패할 수 있습니다.',
    confirmLabel: '연결 해제',
    danger: true,
  });
}

export function confirmRemoveLocalFolder(label: string, path: string): Promise<boolean> {
  const name = label.trim() || path;
  return confirmed({
    title: `"${name}" 폴더 연결을 해제할까요?`,
    message: '연결된 폴더 인덱스가 삭제될 수 있으며, 이 폴더를 쓰는 업무는 파일을 찾지 못할 수 있습니다.',
    confirmLabel: '연결 해제',
    danger: true,
  });
}

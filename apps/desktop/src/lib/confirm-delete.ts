export function confirmDeleteWork(name: string): boolean {
  return window.confirm(
    `"${name}" 업무를 삭제할까요?\n\n저장된 자동화 설정이 삭제되며, 이 업무와 연결된 대화도 목록에서 사라집니다.`,
  );
}

export function confirmDeleteChat(title: string): boolean {
  return window.confirm(`"${title}" 대화를 삭제할까요?\n\n대화 기록만 지워지며 저장된 업무는 유지됩니다.`);
}

export function confirmDeleteExecution(): boolean {
  return window.confirm('이 실행 기록을 삭제할까요?');
}

export function confirmRemoveLocalFolder(label: string, path: string): boolean {
  const name = label.trim() || path;
  return window.confirm(
    `"${name}" 폴더 연결을 해제할까요?\n\n연결된 폴더 인덱스가 삭제될 수 있으며, 이 폴더를 쓰는 업무는 파일을 찾지 못할 수 있습니다.`,
  );
}

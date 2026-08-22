interface WorkspaceRunResultCardProps {
  content: string;
}

export function WorkspaceRunResultCard({ content }: WorkspaceRunResultCardProps) {
  const isApproval = content.includes('승인 대기 중입니다');
  const isSuccess = content.includes('실행이 완료되었습니다');
  const isCancelled = content.includes('실행이 취소되었습니다');

  return (
    <div
      className={`ax-workspace-run-card ${isApproval ? 'ax-workspace-run-card--approval' : ''}${isCancelled ? ' ax-workspace-run-card--cancelled' : ''}`}
      role="status"
    >
      <p className="ax-workspace-run-card-label">
        {isApproval ? '승인 대기' : isSuccess ? '실행 완료' : isCancelled ? '실행 취소' : '실행 실패'}
      </p>
      <p>{content}</p>
    </div>
  );
}

function isRunResultMessage(content: string): boolean {
  return (
    content.includes('실행이 완료되었습니다') ||
    content.includes('승인 대기 중입니다') ||
    content.includes('실행에 실패했습니다') ||
    content.includes('실행이 취소되었습니다')
  );
}

export { isRunResultMessage };

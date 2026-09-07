type SidebarStatusPanelProps =
  | { kind: 'approval'; pendingApprovals: number }
  | { kind: 'activity'; pendingApprovals?: never };

export function SidebarStatusPanel(props: SidebarStatusPanelProps) {
  const message = props.kind === 'approval'
    ? props.pendingApprovals > 0
      ? '대기 ' + props.pendingApprovals + '건 — 중앙 패널에서 승인·거절하세요.'
      : '대기 중인 승인이 없습니다.'
    : '실행 기록은 중앙 패널에서 확인합니다.';

  return (
    <div className="sidebar-panel-section">
      <p className="sidebar-empty">{message}</p>
    </div>
  );
}

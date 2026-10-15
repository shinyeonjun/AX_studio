type SidebarStatusPanelProps =
  | { kind: 'approval'; pendingApprovals: number }
  | { kind: 'activity' | 'usage'; pendingApprovals?: never };

export function SidebarStatusPanel(props: SidebarStatusPanelProps) {
  const message = props.kind === 'approval'
    ? props.pendingApprovals > 0
      ? '대기 ' + props.pendingApprovals + '건 — 승인 화면에서 승인하거나 거절하세요.'
      : '대기 중인 승인이 없습니다.'
    : props.kind === 'usage'
      ? '요청 판단에 쓴 시간과 비용은 가운데 화면에서 비교합니다.'
      : '실행 기록은 가운데 화면에서 확인합니다.';

  return (
    <div className="sidebar-panel-section">
      <p className="sidebar-empty">{message}</p>
    </div>
  );
}

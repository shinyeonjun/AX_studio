import type { InterviewDraft, WorkflowNode } from '@ax-studio/core/workflow-schema';
import type { WorkflowVisualNodeData } from './types.js';
import { displayForTrigger, displayForWorkflowNode } from './node-display.js';

interface NodeDetailPanelProps {
  draft?: InterviewDraft;
  nodeData: WorkflowVisualNodeData | null;
  onRequestEdit: (prompt: string) => void;
  onClose: () => void;
}

function findWorkflowNode(draft: InterviewDraft | undefined, sourceId?: string): WorkflowNode | undefined {
  if (!sourceId || sourceId === '__trigger__') return undefined;
  return draft?.nodes?.find((node) => node.id === sourceId);
}

export function NodeDetailPanel({ draft, nodeData, onRequestEdit, onClose }: NodeDetailPanelProps) {
  if (!nodeData) return null;

  const isTrigger = nodeData.sourceId === '__trigger__';
  const workflowNode = findWorkflowNode(draft, nodeData.sourceId);

  const detailLines: Array<{ label: string; value: string }> = [];

  if (isTrigger && draft) {
    const trigger = displayForTrigger(draft);
    detailLines.push({ label: '시작 조건', value: trigger.label });
    trigger.lines.forEach((line) => detailLines.push({ label: '설정', value: line.text }));
  } else if (workflowNode) {
    if (workflowNode.type === 'ai_decision') {
      detailLines.push({ label: '목적', value: workflowNode.goal ?? nodeData.subtitle ?? '' });
      if (workflowNode.outputFields?.length) {
        detailLines.push({
          label: '결과',
          value: workflowNode.outputFields.map((field) => field.name).join(', '),
        });
      }
    } else if (workflowNode.type === 'human_approval') {
      detailLines.push({ label: '승인 이유', value: workflowNode.reason ?? nodeData.subtitle ?? '' });
    } else if (workflowNode.type === 'if') {
      detailLines.push({ label: '조건', value: nodeData.conditionLabel ?? '' });
    } else if (workflowNode.type === 'action') {
      const display = displayForWorkflowNode(workflowNode);
      display.lines.forEach((line) => detailLines.push({ label: '설정', value: line.text }));
    }
  }

  const editLabel = isTrigger ? '시작 조건' : nodeData.label;
  const editPrompt = isTrigger
    ? '언제 이 업무를 시작할지 어떻게 바꿀까요?'
    : `${editLabel} 단계를 어떻게 바꿀까요?`;

  return (
    <div className="wf-detail-panel">
      <div className="wf-detail-header">
        <div>
          <div className="wf-detail-kicker">워크플로우 노드</div>
          <h3 className="wf-detail-title">{nodeData.label}</h3>
          {nodeData.subtitle && <p className="wf-detail-subtitle">{nodeData.subtitle}</p>}
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      {detailLines.length > 0 && (
        <dl className="wf-detail-list">
          {detailLines.map((line) => (
            <div key={`${line.label}-${line.value}`} className="wf-detail-row">
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <button
        type="button"
        className="btn btn-sm wf-detail-edit"
        onClick={() => onRequestEdit(editPrompt)}
      >
        이 부분 수정하기
      </button>
    </div>
  );
}

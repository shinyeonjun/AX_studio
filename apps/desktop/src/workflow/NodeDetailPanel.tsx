import { useMemo } from 'react';
import type { CompletenessResult, WorkflowCanvasDraft, WorkflowNode } from '@ax-studio/core';
import { connectionGuidance, panelFieldsForSource } from '@ax-studio/core/workflow/canvas/presentation/panel-fields';
import type { SettingsScreen } from '../types/navigation';
import { CONNECTOR_UI_CATALOG, isConnectorVisibleInUi, type ConnectorUiId } from '../constants/connectors';
import type { WorkflowVisualNodeData } from './types.js';
import { displayForTrigger, displayForWorkflowNode } from './node-display.js';

interface NodeDetailPanelProps {
  draft?: WorkflowCanvasDraft;
  nodeData: WorkflowVisualNodeData | null;
  completeness?: CompletenessResult;
  busy?: boolean;
  onRequestEdit: (prompt: string) => void;
  onOpenSettings?: (screen: SettingsScreen) => void;
  onClose: () => void;
}

function findWorkflowNode(draft: WorkflowCanvasDraft | undefined, sourceId?: string): WorkflowNode | undefined {
  if (!sourceId || sourceId === '__trigger__') return undefined;
  return draft?.nodes?.find((node) => node.id === sourceId);
}

function settingsScreenForConnector(connectorId: string): SettingsScreen | null {
  if (!isConnectorVisibleInUi(connectorId as ConnectorUiId)) return null;
  return CONNECTOR_UI_CATALOG[connectorId as ConnectorUiId]?.settingsScreen ?? null;
}

function readOnlyDetailLines(
  draft: WorkflowCanvasDraft | undefined,
  nodeData: WorkflowVisualNodeData,
  workflowNode: WorkflowNode | undefined,
): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [];
  if (nodeData.sourceId === '__trigger__' && draft) {
    const trigger = displayForTrigger(draft);
    lines.push({ label: '시작 조건', value: trigger.label });
    trigger.lines.forEach((line) => lines.push({ label: '설정', value: line.text }));
    return lines;
  }
  if (!workflowNode) return lines;

  if (workflowNode.type === 'ai_decision') {
    lines.push({ label: '목적', value: workflowNode.goal ?? nodeData.subtitle ?? '' });
    if (workflowNode.memo?.trim()) {
      lines.push({ label: '판단 기준', value: workflowNode.memo.trim() });
    }
    if (workflowNode.outputFields?.length) {
      lines.push({
        label: '결과',
        value: workflowNode.outputFields.map((field) => field.name).join(', '),
      });
    }
  } else if (workflowNode.type === 'human_approval') {
    lines.push({ label: '승인 이유', value: workflowNode.reason ?? nodeData.subtitle ?? '' });
  } else if (workflowNode.type === 'if') {
    lines.push({ label: '조건', value: nodeData.conditionLabel ?? '' });
  } else if (workflowNode.type === 'action') {
    if (draft) {
      const display = displayForWorkflowNode(draft, workflowNode);
      display.lines.forEach((line) => lines.push({ label: '설정', value: line.text }));
    }
  }
  return lines;
}

export function NodeDetailPanel({
  draft,
  nodeData,
  completeness,
  busy = false,
  onRequestEdit,
  onOpenSettings,
  onClose,
}: NodeDetailPanelProps) {
  const isTrigger = nodeData?.sourceId === '__trigger__';
  const workflowNode = findWorkflowNode(draft, nodeData?.sourceId);
  const allFields = useMemo(
    () => panelFieldsForSource(draft, nodeData?.sourceId ?? '', completeness),
    [draft, nodeData?.sourceId, completeness],
  );
  const connection = connectionGuidance(completeness?.missingConnections);
  const hasMissingChatFields = allFields.some((field) => field.required && !field.value.trim());

  if (!nodeData) return null;

  const editLabel = isTrigger ? '시작 조건' : nodeData.label;
  const editPrompt = isTrigger
    ? '언제 이 업무를 시작할지 어떻게 바꿀까요?'
    : `${editLabel} 단계를 어떻게 바꿀까요?`;
  const readOnlyLines = readOnlyDetailLines(draft, nodeData, workflowNode);

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

      {connection && (
        <div className="wf-detail-connection">
          <p>{connection.message}</p>
          <div className="wf-detail-connection-actions">
            {connection.connectors.map((connectorId) => {
              const screen = settingsScreenForConnector(connectorId);
              if (!screen || !onOpenSettings) return null;
              return (
                <button
                  key={connectorId}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onOpenSettings(screen)}
                >
                  {CONNECTOR_UI_CATALOG[connectorId as ConnectorUiId]?.title ?? connectorId} 설정
                </button>
              );
            })}
          </div>
        </div>
      )}

      {allFields.length > 0 ? (
        <dl className="wf-detail-list">
          {allFields.map((field) => (
            <div key={field.slot} className="wf-detail-row">
              <dt>
                {field.label}
                {field.required && !field.value.trim() && (
                  <span className="wf-detail-required">필수</span>
                )}
              </dt>
              <dd>{field.value.trim() || '?'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        readOnlyLines.length > 0 && (
          <dl className="wf-detail-list">
            {readOnlyLines.map((line) => (
              <div key={`${line.label}-${line.value}`} className="wf-detail-row">
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        )
      )}

      {hasMissingChatFields && (
        <p className="wf-detail-chat-hint">비어 있는 값은 왼쪽 채팅에서 알려주세요.</p>
      )}

      <button
        type="button"
        className="btn btn-sm wf-detail-edit"
        disabled={busy}
        onClick={() => onRequestEdit(editPrompt)}
      >
        이 부분 수정하기
      </button>
    </div>
  );
}

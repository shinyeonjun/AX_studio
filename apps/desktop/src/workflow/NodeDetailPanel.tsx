import { useMemo } from 'react';
import type { CompletenessResult, WorkflowCanvasDraft } from '@ax-studio/core';
import { panelFieldsForSource } from '@ax-studio/core/workflow/canvas/presentation/panel-fields';
import type { SettingsScreen } from '../types/navigation';
import { CONNECTOR_UI_CATALOG, type ConnectorUiId } from '../constants/connectors';
import type { WorkflowVisualNodeData } from './types.js';
import {
  connectionForNode,
  findWorkflowNode,
  readOnlyDetailLines,
  settingsScreenForConnector,
} from './node-detail/model.js';

interface NodeDetailPanelProps {
  draft?: WorkflowCanvasDraft;
  nodeData: WorkflowVisualNodeData | null;
  completeness?: CompletenessResult;
  busy?: boolean;
  onRequestEdit: (prompt: string) => void;
  onOpenSettings?: (screen: SettingsScreen) => void;
  onClose: () => void;
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
  const connection = connectionForNode(completeness);
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
          <div className="wf-detail-kicker">업무 단계</div>
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

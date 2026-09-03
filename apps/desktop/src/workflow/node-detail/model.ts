import type { CompletenessResult, WorkflowCanvasDraft, WorkflowNode } from '@ax-studio/core';
import { connectionGuidance } from '@ax-studio/core/workflow/canvas/presentation/panel-fields';
import type { SettingsScreen } from '../../types/navigation';
import { CONNECTOR_UI_CATALOG, isConnectorVisibleInUi, type ConnectorUiId } from '../../constants/connectors';
import type { WorkflowVisualNodeData } from '../types.js';
import { displayForTrigger, displayForWorkflowNode } from '../node-display.js';

export function findWorkflowNode(draft: WorkflowCanvasDraft | undefined, sourceId?: string): WorkflowNode | undefined {
  if (!sourceId || sourceId === '__trigger__') return undefined;
  return draft?.nodes?.find((node) => node.id === sourceId);
}

export function settingsScreenForConnector(connectorId: string): SettingsScreen | null {
  if (!isConnectorVisibleInUi(connectorId as ConnectorUiId)) return null;
  return CONNECTOR_UI_CATALOG[connectorId as ConnectorUiId]?.settingsScreen ?? null;
}

export function readOnlyDetailLines(
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

export function connectionForNode(completeness?: CompletenessResult) {
  return connectionGuidance(completeness?.missingConnections);
}

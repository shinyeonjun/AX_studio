import {
  WorkflowCanvasDraftSchema,
  type WorkflowCanvasDraftInput,
  type WorkflowNode,
} from '../../draft/schema.js';
import { resolveIfNodeCondition } from '../../draft/conditions.js';
import type { DraftGraphIssue } from './types.js';

export function validateCanvasDraftStructure(draft: WorkflowCanvasDraftInput): DraftGraphIssue[] {
  const parsed = WorkflowCanvasDraftSchema.parse(draft);
  const issues: DraftGraphIssue[] = [];
  const nodes = parsed.nodes ?? [];
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ stepId: node.id, message: `노드 id가 중복되었습니다: ${node.id}` });
    }
    nodeIds.add(node.id);
  }

  for (const node of nodes) {
    if (node.type !== 'if') continue;
    if (!resolveIfNodeCondition(node)) {
      issues.push({ stepId: node.id, message: `${node.id} if 노드에 유효한 JSON condition이 필요합니다.` });
    }
    const thenIds = node.thenStepIds ?? [];
    const elseIds = node.elseStepIds ?? [];
    if (thenIds.length === 0) {
      issues.push({ stepId: node.id, message: `${node.id} if 노드에 thenStepIds가 필요합니다.` });
    }
    for (const targetId of [...thenIds, ...elseIds]) {
      if (!nodeIds.has(targetId)) {
        issues.push({ stepId: node.id, message: `${node.id}가 존재하지 않는 노드 ${targetId}를 가리킵니다.` });
      }
      if (targetId === node.id) {
        issues.push({ stepId: node.id, message: `${node.id} if 노드는 자기 자신을 분기 대상으로 가질 수 없습니다.` });
      }
    }
  }
  return issues;
}

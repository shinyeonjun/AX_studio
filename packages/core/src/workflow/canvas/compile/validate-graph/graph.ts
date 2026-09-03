import {
  WorkflowCanvasDraftSchema,
  type WorkflowCanvasDraft,
  type WorkflowCanvasDraftInput,
  type WorkflowNode,
} from '../../draft/schema.js';
import { resolveNodeConnectorAction } from '../../draft/actions.js';
import { resolveCapability } from '../../../../catalog/capability-graph.js';
import { appendReferenceIssues } from './references.js';
import { validateCanvasDraftStructure } from './structure.js';
import type { DraftGraphIssue } from './types.js';

function isNotifyAction(draft: WorkflowCanvasDraft, node: WorkflowNode): boolean {
  if (node.type !== 'action') return false;
  const resolved = resolveNodeConnectorAction(draft, node);
  if (!resolved) return false;
  return resolveCapability(resolved.connector, resolved.action)?.notification === true;
}

function hasEnumDecision(nodes: WorkflowNode[]): boolean {
  return nodes.some(
    (node) =>
      node.type === 'ai_decision' &&
      node.outputFields?.some((field) => (field.enumValues?.length ?? 0) > 1),
  );
}

function branchEntryIds(nodes: WorkflowNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'if') continue;
    node.thenStepIds?.forEach((id) => ids.add(id));
    node.elseStepIds?.forEach((id) => ids.add(id));
  }
  return ids;
}

/** Draft-level checks before/alongside IR compile — n8n-style graph, not flat action lists. */
export function validateCanvasDraftGraph(draft: WorkflowCanvasDraftInput): DraftGraphIssue[] {
  const parsed = WorkflowCanvasDraftSchema.parse(draft);
  const issues: DraftGraphIssue[] = validateCanvasDraftStructure(parsed);
  const nodes = parsed.nodes ?? [];
  const notifyActions = nodes.filter((node) => isNotifyAction(parsed, node));
  const notifyCount = notifyActions.length;
  const hasDecision = nodes.some((node) => node.type === 'ai_decision');
  const hasBranch = nodes.some((node) => node.type === 'if');

  if (notifyCount >= 2 && (!hasDecision || !hasBranch)) {
    issues.push({
      message:
        '알림 목적지가 여러 개면 ai_decision으로 분류한 뒤 if 분기로 연결해야 합니다.',
    });
  }

  if (notifyCount >= 2 && hasBranch) {
    const entries = branchEntryIds(nodes);
    const orphans = notifyActions.filter((node) => !entries.has(node.id));
    if (orphans.length > 0) {
      issues.push({
        stepId: orphans[0]?.id,
        message:
          '알림 노드는 if의 thenStepIds/elseStepIds로 연결해야 합니다. 일렬로 나열하지 마세요.',
      });
    }
  }

  if (hasEnumDecision(nodes) && !hasBranch) {
    const decision = nodes.find(
      (node) =>
        node.type === 'ai_decision' &&
        node.outputFields?.some((field) => (field.enumValues?.length ?? 0) > 1),
    );
    issues.push({
      stepId: decision?.id,
      message:
        '분류 결과가 여러 값이면 if 노드로 갈라야 합니다. enumValues마다 if condition과 then/else 연결을 만드세요 (N갈래면 if N−1개를 else로 연결).',
    });
  }

  for (const node of nodes) {
    if (node.type !== 'action') continue;
    if (!resolveNodeConnectorAction(parsed, node)) {
      issues.push({
        stepId: node.id,
        message: `${node.id} action 노드에 actionRef가 필요합니다.`,
      });
    }
  }

  appendReferenceIssues(issues, parsed, nodes);

  return issues;
}

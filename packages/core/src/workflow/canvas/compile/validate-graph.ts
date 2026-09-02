import { WorkflowCanvasDraftSchema, type WorkflowCanvasDraft, type WorkflowCanvasDraftInput, type WorkflowNode } from '../draft/schema.js';
import { getNodeParams, resolveNodeConnectorAction } from '../draft/actions.js';
import { resolveIfNodeCondition } from '../draft/conditions.js';
import { resolveCapability } from '../../../catalog/capability-graph.js';
import type { ConditionExpr } from '../../../runtime/condition-expr.js';

export interface DraftGraphIssue {
  stepId?: string;
  message: string;
}

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

function conditionRefs(condition: ConditionExpr | undefined): string[] {
  if (!condition || typeof condition !== 'object') return [];
  if (!condition) return [];
  if (condition.op === 'and' || condition.op === 'or') {
    return condition.args.flatMap((item) => conditionRefs(item));
  }
  if (condition.op === 'not') return conditionRefs(condition.arg);
  if (!('left' in condition) || !('right' in condition)) return [];
  return [
    ...('ref' in condition.left ? [condition.left.ref] : []),
    ...('ref' in condition.right ? [condition.right.ref] : []),
  ];
}

function templateRefs(value: unknown): string[] {
  if (typeof value === 'string') {
    return [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]!.trim());
  }
  if (Array.isArray(value)) return value.flatMap(templateRefs);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 1 && typeof record.ref === 'string') return [record.ref.trim()];
  return Object.values(record).flatMap(templateRefs);
}

function addReferenceIssues(
  issues: DraftGraphIssue[],
  draft: WorkflowCanvasDraft,
  nodes: WorkflowNode[],
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const references = nodes.flatMap((node) => [
    ...(node.type === 'if' ? conditionRefs(resolveIfNodeCondition(node)) : []),
    ...(node.type === 'action' ? templateRefs(getNodeParams(draft, node)) : []),
  ]);

  for (const reference of references) {
    const [root, field] = reference.split('.', 2);
    const source = byId.get(root!);
    if (!source || source.type !== 'ai_decision') continue;
    if (!field) {
      issues.push({
        stepId: source.id,
        message: `${source.id} 결과는 필드명을 포함해야 합니다. 예: ${source.id}.riskLevel`,
      });
      continue;
    }
    const outputField = source.outputFields?.find((candidate) => candidate.name === field);
    if (!outputField) {
      issues.push({
        stepId: source.id,
        message: `${source.id}에 참조된 출력 필드 ${field}가 선언되지 않았습니다. outputFields에 추가하세요.`,
      });
    }
  }
}

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

/** Contract-only validation used before a plan is persisted. */
export function validateCanvasDraftReferences(draft: WorkflowCanvasDraftInput): DraftGraphIssue[] {
  const parsed = WorkflowCanvasDraftSchema.parse(draft);
  const issues: DraftGraphIssue[] = [];
  addReferenceIssues(issues, parsed, parsed.nodes ?? []);
  return issues;
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

  addReferenceIssues(issues, parsed, nodes);

  return issues;
}

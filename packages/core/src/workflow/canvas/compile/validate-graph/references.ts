import {
  WorkflowCanvasDraftSchema,
  type WorkflowCanvasDraft,
  type WorkflowCanvasDraftInput,
  type WorkflowNode,
} from '../../draft/schema.js';
import { getNodeParams } from '../../draft/actions.js';
import { resolveIfNodeCondition } from '../../draft/conditions.js';
import type { ConditionExpr } from '../../../../runtime/condition-expr.js';
import type { DraftGraphIssue } from './types.js';

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

export function appendReferenceIssues(
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

/** Contract-only validation used before a plan is persisted. */
export function validateCanvasDraftReferences(draft: WorkflowCanvasDraftInput): DraftGraphIssue[] {
  const parsed = WorkflowCanvasDraftSchema.parse(draft);
  const issues: DraftGraphIssue[] = [];
  appendReferenceIssues(issues, parsed, parsed.nodes ?? []);
  return issues;
}

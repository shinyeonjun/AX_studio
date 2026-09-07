import type { WorkflowCanvasDraft, WorkflowNode } from '@ax-studio/core';

export type WorkflowNodeChange = 'unchanged' | 'added' | 'modified';

export interface WorkflowDiffSummary {
  nodeChanges: Map<string, WorkflowNodeChange>;
  triggerChanged: boolean;
  addedCount: number;
  modifiedCount: number;
  hasChanges: boolean;
}

function triggerSnapshot(draft: WorkflowCanvasDraft): string {
  return JSON.stringify({
    triggerType: draft.triggerType,
    schedule: draft.schedule ?? '',
    timezone: draft.timezone ?? '',
    runAt: draft.runAt ?? '',
    gmailAccount: draft.gmailAccount ?? '',
    slackChannel: draft.slackChannel ?? '',
  });
}

function nodeSnapshot(draft: WorkflowCanvasDraft, node: WorkflowNode): string {
  return JSON.stringify({
    node,
    action: draft.actions?.[node.id],
  });
}

export function computeWorkflowDiff(
  baseline: WorkflowCanvasDraft | undefined,
  current: WorkflowCanvasDraft | undefined,
): WorkflowDiffSummary {
  const nodeChanges = new Map<string, WorkflowNodeChange>();
  if (!baseline || !current) {
    return { nodeChanges, triggerChanged: false, addedCount: 0, modifiedCount: 0, hasChanges: false };
  }

  const baselineById = new Map((baseline.nodes ?? []).map((node) => [node.id, node]));
  const currentById = new Map((current.nodes ?? []).map((node) => [node.id, node]));

  let addedCount = 0;
  let modifiedCount = 0;

  for (const [id, node] of currentById) {
    const prior = baselineById.get(id);
    if (!prior) {
      nodeChanges.set(id, 'added');
      addedCount += 1;
      continue;
    }
    if (nodeSnapshot(baseline, prior) !== nodeSnapshot(current, node)) {
      nodeChanges.set(id, 'modified');
      modifiedCount += 1;
      continue;
    }
    nodeChanges.set(id, 'unchanged');
  }

  const triggerChanged = triggerSnapshot(baseline) !== triggerSnapshot(current);
  const metaChanged =
    (baseline.goal ?? '') !== (current.goal ?? '') ||
    (baseline.success ?? '') !== (current.success ?? '') ||
    (baseline.name ?? '') !== (current.name ?? '');

  return {
    nodeChanges,
    triggerChanged,
    addedCount,
    modifiedCount,
    hasChanges: addedCount > 0 || modifiedCount > 0 || triggerChanged || metaChanged,
  };
}

export function diffLabel(summary: WorkflowDiffSummary): string | null {
  const parts: string[] = [];
  if (summary.addedCount > 0) parts.push(`${summary.addedCount}개 추가`);
  if (summary.modifiedCount > 0) parts.push(`${summary.modifiedCount}개 수정`);
  if (summary.triggerChanged) parts.push('시작 조건 변경');
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

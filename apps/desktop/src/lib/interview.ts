export function getInterviewStep(interview: { done?: boolean } | null, saved: boolean): number {
  if (saved) return 4;
  if (!interview) return 1;
  if (!interview.done) return 2;
  return 3;
}

interface DraftStep {
  type?: string;
  id?: string;
  connector?: string;
  action?: string;
  goal?: string;
  reason?: string;
  condition?: string;
}

export function workflowNodeLabels(draft: unknown): string[] {
  if (!draft || typeof draft !== 'object') return [];
  const steps = (draft as { steps?: DraftStep[] }).steps;
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => {
    if (step.type === 'action') return `${step.connector}.${step.action}`;
    if (step.type === 'ai_decision') return `AI · ${step.goal ?? '판단'}`;
    if (step.type === 'if') return `조건 · ${step.condition ?? ''}`;
    if (step.type === 'human_approval') return `승인 · ${step.reason ?? ''}`;
    return step.id ?? 'node';
  });
}

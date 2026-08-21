import { describe, expect, it } from 'vitest';
import { planToInterviewDraft, type WorkflowPlan } from '../../plan/schema.js';
import { buildIRFromWorkflow } from '../../compile/builder.js';

describe('interview trigger resolution', () => {
  it('keeps an omitted trigger unresolved instead of converting it to manual', () => {
    const plan: WorkflowPlan = {
      name: '폴더 PDF 처리',
      goal: '연결된 폴더의 PDF를 처리한다',
      nodes: [],
    };

    const draft = planToInterviewDraft(plan, {}, plan.goal!);
    const ir = buildIRFromWorkflow(draft);

    expect(draft.triggerType).toBeUndefined();
    expect(ir.trigger).toBeUndefined();
  });

  it('preserves an explicitly selected manual trigger', () => {
    const plan: WorkflowPlan = {
      name: '현재 PDF 처리',
      goal: '현재 PDF를 처리한다',
      triggerType: 'manual',
      nodes: [],
    };

    const ir = buildIRFromWorkflow(planToInterviewDraft(plan, {}, plan.goal!));

    expect(ir.trigger?.type).toBe('manual');
  });
});

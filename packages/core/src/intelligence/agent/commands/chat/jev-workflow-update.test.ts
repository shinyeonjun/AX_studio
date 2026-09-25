import { describe, expect, it } from 'vitest';
import { MAX_DECISION_CHOICE_CRITERIA } from '../../../../contracts/decision.js';
import { compileJevWorkflowUpdate } from './jev-workflow-update.js';
import {
  quotedWorkflowFieldUpdate,
  workflowStepRemovalQuestions,
} from './jev-workflow-update.js';

describe('workflow update intent', () => {
  it('builds a field update only from a quoted value with edit wording', () => {
    expect(quotedWorkflowFieldUpdate('이름을 "주간 재고 요약"으로 바꿔줘', 'name'))
      .toEqual({ op: 'set', path: 'name', value: '주간 재고 요약' });
    expect(quotedWorkflowFieldUpdate('성공 조건을 "누락 0개"로 바꿔줘', 'success'))
      .toEqual({ op: 'set', path: 'success', value: '누락 0개' });
    expect(quotedWorkflowFieldUpdate('success criteria "zero missing rows" change', 'success'))
      .toEqual({ op: 'set', path: 'success', value: 'zero missing rows' });
    expect(quotedWorkflowFieldUpdate('이름은 "주간 재고 요약"으로 유지해줘', 'name')).toBeUndefined();
  });

  it('groups every existing step into bounded Jev choices without dropping candidates', () => {
    const steps = Array.from({ length: MAX_DECISION_CHOICE_CRITERIA + 45 }, (_, index) => ({
      id: `step-${index}`,
      type: 'action',
      label: `action ${index}`,
    }));
    const groups = workflowStepRemovalQuestions(steps.map((step, index) => ({ step, index })));

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flatMap(({ candidates }) => candidates.map(({ index }) => index)))
      .toEqual(steps.map((_, index) => index));
    for (const { question } of groups) {
      expect(Object.keys(question.criteria ?? {}).length).toBeLessThanOrEqual(MAX_DECISION_CHOICE_CRITERIA);
      expect(question.criteria).toHaveProperty('none');
      expect(question.instructions?.focus).toContain('exact listed existing step');
    }
    expect(groups[0]?.question.criteria).toHaveProperty('step_0');
    expect(groups.at(-1)?.question.criteria).toHaveProperty(`step_${steps.length - 1}`);
  });
});

describe('compileJevWorkflowUpdate', () => {
  it('compiles only explicit quoted field changes against the current version', () => {
    expect(compileJevWorkflowUpdate({
      userMessage: '현재 workflow 이름을 "주간 재고 요약"으로 바꿔줘.',
      workflowId: 'workflow-1',
      workflowVersion: 3,
      answers: {},
    })).toEqual({
      kind: 'command',
      command: {
        name: 'workflow.update',
        args: {
          workflowId: 'workflow-1',
          baseVersion: 3,
          operations: [{ op: 'set', path: 'name', value: '주간 재고 요약' }],
        },
      },
    });
  });

  it('uses Jev categorical removal intent and resolves the exact existing step without a second score cutoff', () => {
    const base = {
      userMessage: 'Slack 알림은 이제 필요 없어.',
      workflowId: 'workflow-1',
      workflowVersion: 3,
      steps: [{ id: 'notify-1', type: 'slack.send', label: 'Slack 알림' }],
    };

    expect(compileJevWorkflowUpdate({
      ...base,
      answers: {
        explicit_workflow_step_removal: { type: 'choice', choice: 'remove_now', probabilities: { remove_now: 0.54 }, confidence: 0.54 },
        workflow_step_to_remove: {
          type: 'choice', choice: 'step_0', probabilities: { step_0: 0.54, none: 0.46 }, confidence: 0.54,
        },
      },
    })).toEqual({
      kind: 'command',
      command: {
        name: 'workflow.update',
        args: {
          workflowId: 'workflow-1',
          baseVersion: 3,
          operations: [{ op: 'remove_step', stepId: 'notify-1' }],
        },
      },
    });

    expect(compileJevWorkflowUpdate({
      ...base,
      answers: { explicit_workflow_step_removal: { type: 'choice', choice: 'remove_now', probabilities: { remove_now: 0.99 }, confidence: 0.99 } },
    })).toMatchObject({ kind: 'clarify' });

    expect(compileJevWorkflowUpdate({
      ...base,
      answers: {
        explicit_workflow_step_removal: { type: 'choice', choice: 'unclear', probabilities: { unclear: 0.99 }, confidence: 0.99 },
        workflow_step_to_remove: {
          type: 'choice', choice: 'step_0', probabilities: { step_0: 0.99 }, confidence: 0.99,
        },
      },
    })).toMatchObject({ kind: 'clarify' });

    expect(compileJevWorkflowUpdate({
      ...base,
      answers: {
        explicit_workflow_step_removal: { type: 'boolean', probability: 1 },
        workflow_step_to_remove: {
          type: 'choice', choice: 'step_0', probabilities: { step_0: 0.99 }, confidence: 0.99,
        },
      },
    })).toMatchObject({ kind: 'clarify' });
  });

  it('refuses stale versions and nonexistent step indexes while accepting a high existing index', () => {
    const base = {
      userMessage: 'workflow 이름을 "새 이름"으로 바꿔줘.',
      workflowId: 'workflow-1',
      answers: {},
    };
    expect(compileJevWorkflowUpdate({ ...base, workflowVersion: 0 })).toMatchObject({ kind: 'clarify' });

    const steps = Array.from({ length: MAX_DECISION_CHOICE_CRITERIA + 1 }, (_, index) => ({
      id: `step-${index}`, type: 'action', label: `step ${index}`,
    }));
    const lastIndex = steps.length - 1;
    expect(compileJevWorkflowUpdate({
      userMessage: '마지막 단계를 제거해줘.',
      workflowId: 'workflow-1',
      workflowVersion: 3,
      steps,
      answers: {
        explicit_workflow_step_removal: { type: 'choice', choice: 'remove_now', probabilities: { remove_now: 0.99 }, confidence: 0.99 },
        workflow_step_to_remove: {
          type: 'choice', choice: `step_${lastIndex}`, probabilities: { [`step_${lastIndex}`]: 0.95 }, confidence: 0.95,
        },
      },
    })).toMatchObject({
      kind: 'command',
      command: { args: { operations: [{ op: 'remove_step', stepId: `step-${lastIndex}` }] } },
    });

    expect(compileJevWorkflowUpdate({
      userMessage: '마지막 단계를 제거해줘.',
      workflowId: 'workflow-1',
      workflowVersion: 3,
      steps,
      answers: {
        explicit_workflow_step_removal: { type: 'choice', choice: 'remove_now', probabilities: { remove_now: 0.99 }, confidence: 0.99 },
        workflow_step_to_remove: {
          type: 'choice', choice: `step_${steps.length}`, probabilities: { [`step_${steps.length}`]: 0.95 }, confidence: 0.95,
        },
      },
    })).toMatchObject({ kind: 'clarify' });
  });
});

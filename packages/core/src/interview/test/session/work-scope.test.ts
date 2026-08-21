import { describe, expect, it } from 'vitest';
import { bootstrapInterviewFromWorkflow } from '../../bootstrap/from-workflow.js';
import { createInterviewState } from '../../session/state.js';
import { buildAssistantMessage } from '../../session/messages.js';
import type { CompletenessResult } from '../../slots/types.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { workScopeTriggerIssue } from '../../session/work-scope.js';
import { assessSessionCompleteness } from '../../session/completeness.js';

describe('work scope', () => {
  it('keeps the trigger unresolved until the plan states the one-time start', () => {
    const state = createInterviewState('PDF 분류', 'once');
    expect(state.workScope).toBe('once');
    expect(state.workflow.triggerType).toBeUndefined();
    expect(state.slotValues.triggerType).toBeUndefined();
  });

  it('leaves trigger empty for recurring scope', () => {
    const state = createInterviewState('새 메일 오면 Slack', 'recurring');
    expect(state.workScope).toBe('recurring');
    expect(state.workflow.triggerType).toBeUndefined();
    expect(state.slotValues.triggerType).toBeUndefined();
  });

  it('skips trigger panel hint for once scope', () => {
    const completeness: CompletenessResult = {
      slots: [
        { slot: 'trigger', filled: false, label: '시작', question: '언제 실행할까요?' },
        { slot: 'a.params.channel', filled: false, label: 'Slack', question: 'Slack 채널은?' },
      ],
      missingRequired: ['trigger', 'a.params.channel'],
      deployable: false,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('Slack 채널을 알려주세요.', completeness, false, 'once');

    expect(text).toBe('Slack 채널을 알려주세요.');
    expect(text).not.toContain('시작 노드');
  });

  it('asks trigger questions in chat for recurring scope', () => {
    const completeness: CompletenessResult = {
      slots: [{ slot: 'trigger', filled: false, label: '시작', question: '언제 실행할까요?' }],
      missingRequired: ['trigger'],
      deployable: false,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('', completeness, false, 'recurring');

    expect(text).toBe('언제 실행할까요?');
    expect(text).not.toContain('시작 노드');
  });

  it('infers work scope when bootstrapping saved workflows', () => {
    const manual: WorkflowIR = {
      name: '일회',
      goal: '일회',
      steps: [],
      trigger: { type: 'manual' },
      assumptions: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      dataPolicy: { emailBody: { cloudAllowed: false } },
    };
    const recurring: WorkflowIR = {
      ...manual,
      name: '반복',
      trigger: { type: 'schedule', schedule: '0 9 * * *' },
    };

    expect(bootstrapInterviewFromWorkflow(manual, 'w1').workScope).toBe('once');
    expect(bootstrapInterviewFromWorkflow(recurring, 'w2').workScope).toBe('recurring');
  });

  it('reports a trigger that contradicts the selected work scope', () => {
    expect(workScopeTriggerIssue('recurring', 'manual')).toContain('다회성 업무');
    expect(workScopeTriggerIssue('once', 'gmail.new_message')).toContain('일회성 업무');
    expect(workScopeTriggerIssue('recurring', 'gmail.new_message')).toBeUndefined();
  });

  it('keeps a conflicting trigger non-deployable at the session boundary', () => {
    const state = createInterviewState('반복 업무', 'recurring');
    const completeness = assessSessionCompleteness(
      {
        ...state,
        workflow: { ...state.workflow, triggerType: 'manual' },
      },
      [],
    );

    expect(completeness.deployable).toBe(false);
    expect(completeness.missingRequired).toContain('scope.trigger');
  });
});

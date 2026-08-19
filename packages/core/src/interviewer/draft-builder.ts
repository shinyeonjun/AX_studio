import type { SkillIR } from '../skill/schema.js';

type DraftExtensions = Partial<SkillIR> & {
  triggerType?: string;
  schedule?: string;
  timezone?: string;
  gmailAccount?: string;
  slackChannel?: string;
  localFilePath?: string;
  includeGmailSend?: boolean;
  includeInvestigation?: boolean;
};

export function buildIRFromDraft(draft: Partial<SkillIR>): Partial<SkillIR> {
  const steps: SkillIR['steps'] = [];
  const ext = draft as DraftExtensions;

  if (draft.goal?.includes('분류') || draft.goal?.includes('문의')) {
    steps.push({
      type: 'ai_decision',
      id: 'classify',
      goal: '문의 분류',
      investigation: false,
      maxReads: 1,
    });
    steps.push({
      type: 'if',
      id: 'if_critical',
      condition: 'classify.category === "critical"',
      thenStepIds: ['slack_notify'],
      elseStepIds: [],
    });
    steps.push({
      type: 'action',
      id: 'slack_notify',
      connector: 'slack',
      action: 'message.send',
      params: { channel: ext.slackChannel ?? '#general' },
      sideEffect: 'EXTERNAL',
    });
    if (ext.includeGmailSend) {
      steps.push({
        type: 'action',
        id: 'draft_reply',
        connector: 'gmail',
        action: 'draft.create',
        params: {},
        sideEffect: 'REVERSIBLE',
      });
      steps.push({
        type: 'human_approval',
        id: 'approve_send',
        reason: '고객에게 이메일 전송',
        forActionIds: ['send_reply'],
      });
      steps.push({
        type: 'action',
        id: 'send_reply',
        connector: 'gmail',
        action: 'message.send',
        params: {},
        sideEffect: 'EXTERNAL_HIGH',
      });
    }
  } else if (draft.goal?.includes('매출') || draft.goal?.includes('보고')) {
    steps.push({
      type: 'action',
      id: 'read_data',
      connector: 'local_sheet',
      action: 'read',
      params: { path: ext.localFilePath ?? './data/sales.csv' },
      sideEffect: 'NONE',
    });
    steps.push({
      type: 'ai_decision',
      id: 'analyze',
      goal: '데이터 분석',
      investigation: ext.includeInvestigation ?? false,
      maxReads: 4,
    });
    steps.push({
      type: 'action',
      id: 'slack_report',
      connector: 'slack',
      action: 'message.send',
      params: { channel: ext.slackChannel ?? '#general' },
      sideEffect: 'EXTERNAL',
    });
  } else {
    steps.push({
      type: 'ai_decision',
      id: 'main',
      goal: draft.goal ?? '업무 수행',
      investigation: ext.includeInvestigation ?? false,
      maxReads: 4,
    });
  }

  let trigger: SkillIR['trigger'] = { type: 'manual' };
  if (ext.trigger) trigger = ext.trigger;
  else if (ext.triggerType === 'schedule') {
    trigger = { type: 'schedule', schedule: ext.schedule ?? '0 9 * * 1', timezone: ext.timezone ?? 'Asia/Seoul' };
  } else if (ext.triggerType === 'gmail.new_message') {
    trigger = { type: 'gmail.new_message', accountId: ext.gmailAccount ?? 'primary' };
  }

  return {
    ...draft,
    trigger,
    steps,
    success: draft.success ?? '작업 완료',
    version: 1,
    sideEffects: Object.fromEntries(
      steps.filter((s) => s.type === 'action').map((s) => [s.id, s.sideEffect]),
    ),
    inputs: draft.inputs ?? [],
  };
}

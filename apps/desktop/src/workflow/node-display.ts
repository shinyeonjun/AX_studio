import { resolveCapability } from '@ax-studio/core/capability-graph';
import { formatCondition, type ConditionExpr } from '@ax-studio/core/condition-expr';
import type { CompletenessResult } from '@ax-studio/core/requiredness';
import type { InterviewDraft, WorkflowNode } from '@ax-studio/core/workflow-schema';
import { connectorIconSrc, triggerIconSrc } from './node-icons.js';
import type { WorkflowCardDisplay, WorkflowVisualLine } from './types';

const ACTION_SUMMARY: Record<string, string> = {
  'gmail.messages.read': '메일 읽기',
  'gmail.messages.search': '메일 검색',
  'gmail.draft.create': '초안 작성',
  'gmail.message.send': '메일 발송',
  'slack.message.send': 'Slack 알림',
};

function truncate(text: string, max = 28): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function slackNotifySummary(channel?: unknown): string {
  const raw = typeof channel === 'string' ? channel.trim() : '';
  if (!raw) return 'Slack 알림';
  const label = raw.startsWith('#') ? raw : `#${raw}`;
  return `${label}에 알림`;
}

function aiDisplay(
  goal?: string,
  outputFields?: Array<{ name: string; description?: string }>,
): { summary: string; captionSub?: string } {
  const g = goal?.trim() ?? '';
  if (!g) return { summary: '내용 분석' };

  const emailMatch = g.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
  const captionSub = emailMatch ? `대상: ${emailMatch[0]}` : undefined;

  if (/요약/.test(g)) return { summary: '메일 내용 요약', captionSub };
  if (/분류/.test(g)) return { summary: '내용 분류', captionSub };
  if (/추출/.test(g)) return { summary: '정보 추출', captionSub };
  if (/판단|결정/.test(g)) return { summary: 'AI 판단', captionSub };
  if (/생성|작성/.test(g)) return { summary: '내용 생성', captionSub };
  if (/분석/.test(g)) return { summary: '내용 분석', captionSub };

  if (outputFields?.length) {
    const hint = outputFields[0]?.description || outputFields[0]?.name;
    if (hint) return { summary: truncate(hint, 22), captionSub };
  }

  const stripped = g
    .replace(/^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}에서\s*(온\s*)?(메일|메시지|이메일)?\s*/i, '')
    .replace(/을?\s*(간결하게\s*)?(요약|분석|판단)한다\.?$/i, '')
    .trim();
  return { summary: stripped ? truncate(stripped, 22) : 'AI 분석', captionSub };
}

function connectorBrand(connector?: string): string {
  if (connector === 'gmail') return 'Gmail';
  if (connector === 'slack') return 'Slack';
  if (connector === 'rdb') return 'DB';
  if (connector === 'report') return 'Report';
  if (connector === 'local_sheet') return 'Sheet';
  return connector ?? 'Action';
}

function actionCard(node: WorkflowNode, slots?: CompletenessResult['slots']): WorkflowCardDisplay {
  const cap = node.connector && node.action ? resolveCapability(node.connector, node.action) : undefined;
  const capId = cap?.id ?? '';
  const summary =
    ACTION_SUMMARY[capId] ??
    (capId === 'slack.message.send'
      ? slackNotifySummary(node.params?.channel)
      : truncate(node.goal ?? cap?.description ?? '실행', 24));

  let captionSub: string | undefined;
  if (capId === 'slack.message.send') {
    captionSub = undefined;
  } else if (cap?.params.length) {
    const first = cap.params.find((p) => node.params?.[p.name]);
    if (first) captionSub = truncate(String(node.params?.[first.name] ?? ''), 32);
  }

  void slots;

  return {
    header: 'Action',
    brand: connectorBrand(node.connector),
    brandStyle: 'bracket',
    summary,
    captionSub,
  };
}

function slotFilled(slots: CompletenessResult['slots'] | undefined, slotId: string): boolean {
  return slots?.find((slot) => slot.slot === slotId)?.filled ?? false;
}

function paramLine(
  capId: string,
  paramName: string,
  label: string,
  value: string | undefined,
  slots: CompletenessResult['slots'] | undefined,
): WorkflowVisualLine {
  const slotId = `${capId}.${paramName}`;
  const filled = Boolean(value?.trim()) || slotFilled(slots, slotId);
  return {
    text: value?.trim() ? `${label}: ${value.trim()}` : `${label}: ?`,
    complete: filled,
  };
}

function actionTitle(node: WorkflowNode): string {
  if (!node.connector || !node.action) return '실행';
  const cap = resolveCapability(node.connector, node.action);
  const capId = cap?.id ?? '';
  if (ACTION_SUMMARY[capId]) return ACTION_SUMMARY[capId];
  return connectorBrand(node.connector);
}

function actionLines(
  node: WorkflowNode,
  slots: CompletenessResult['slots'] | undefined,
): WorkflowVisualLine[] {
  if (!node.connector || !node.action) return [{ text: '설정 필요', complete: false }];
  const cap = resolveCapability(node.connector, node.action);
  if (!cap) return [{ text: '연결 확인 필요', complete: false }];

  const lines: WorkflowVisualLine[] = [];
  for (const param of cap.params) {
    const value = node.params?.[param.name];
    lines.push(paramLine(cap.id, param.name, param.label, value, slots));
  }
  if (lines.length === 0 && node.goal) {
    lines.push({ text: node.goal, complete: true });
  }
  return lines.slice(0, 3);
}

function triggerLabel(draft: InterviewDraft): {
  label: string;
  subtitle?: string;
  lines: WorkflowVisualLine[];
  iconSrc?: string;
  tooltip?: string;
  card: WorkflowCardDisplay;
} {
  switch (draft.triggerType) {
    case 'gmail.new_message':
      return {
        label: 'Gmail',
        iconSrc: triggerIconSrc('gmail.new_message'),
        tooltip: draft.gmailAccount?.trim()
          ? `새 Gmail · ${draft.gmailAccount.trim()}`
          : '새 Gmail · 계정 미설정',
        lines: [
          {
            text: draft.gmailAccount?.trim() ? `계정: ${draft.gmailAccount.trim()}` : '계정: ?',
            complete: Boolean(draft.gmailAccount?.trim()),
          },
        ],
        card: {
          header: 'Trigger',
          brand: 'Gmail',
          brandStyle: 'bracket',
          summary: '새 메일 도착',
        },
      };
    case 'slack.new_message':
      return {
        label: 'Slack',
        iconSrc: triggerIconSrc('slack.new_message'),
        tooltip: draft.slackChannel?.trim()
          ? `Slack 새 메시지 · ${draft.slackChannel.trim()}`
          : 'Slack 새 메시지 · 채널 미설정',
        lines: [
          {
            text: draft.slackChannel?.trim() ? `채널: ${draft.slackChannel.trim()}` : '채널: ?',
            complete: Boolean(draft.slackChannel?.trim()),
          },
        ],
        card: {
          header: 'Trigger',
          brand: 'Slack',
          brandStyle: 'plain',
          summary: draft.slackChannel?.trim() ? '새 메시지' : '새 메시지',
        },
      };
    case 'schedule':
      return {
        label: '예약',
        tooltip: draft.schedule?.trim() ? `예약 · ${draft.schedule.trim()}` : '예약 · 스케줄 미설정',
        lines: [
          {
            text: draft.schedule?.trim() ? draft.schedule.trim() : '스케줄: ?',
            complete: Boolean(draft.schedule?.trim()),
          },
        ],
        card: {
          header: 'Trigger',
          brand: 'Schedule',
          brandStyle: 'bracket',
          summary: draft.schedule?.trim() ? truncate(draft.schedule, 22) : '예약 실행',
        },
      };
    case 'once':
      return {
        label: '1회',
        tooltip: draft.runAt?.trim() ? `1회 실행 · ${draft.runAt.trim()}` : '1회 실행 · 시각 미설정',
        lines: [
          {
            text: draft.runAt?.trim() ? draft.runAt.trim() : '시각: ?',
            complete: Boolean(draft.runAt?.trim()),
          },
        ],
        card: {
          header: 'Trigger',
          brand: 'Once',
          brandStyle: 'bracket',
          summary: '1회 실행',
          captionSub: draft.runAt?.trim() ? truncate(draft.runAt, 22) : undefined,
        },
      };
    default:
      return {
        label: '수동',
        tooltip: draft.goal?.trim() || '수동 실행',
        lines: [],
        card: {
          header: 'Trigger',
          brand: 'Manual',
          brandStyle: 'bracket',
          summary: draft.goal?.trim() ? truncate(draft.goal, 24) : '수동 실행',
        },
      };
  }
}

function conditionText(condition: ConditionExpr | undefined): string {
  if (!condition) return '조건: ?';
  return formatCondition(condition);
}

export function displayForTrigger(
  draft: InterviewDraft,
  slots?: CompletenessResult['slots'],
): {
  label: string;
  subtitle?: string;
  lines: WorkflowVisualLine[];
  incomplete: boolean;
  iconSrc?: string;
  tooltip?: string;
  card: WorkflowCardDisplay;
} {
  const base = triggerLabel(draft);
  const incomplete = base.lines.some((line) => !line.complete);
  void slots;
  return { ...base, incomplete };
}

export function displayForWorkflowNode(
  node: WorkflowNode,
  slots?: CompletenessResult['slots'],
): {
  kind: 'action' | 'ai_decision' | 'if' | 'human_approval';
  label: string;
  subtitle?: string;
  lines: WorkflowVisualLine[];
  incomplete: boolean;
  conditionLabel?: string;
  iconSrc?: string;
  tooltip?: string;
  card: WorkflowCardDisplay;
} {
  switch (node.type) {
    case 'action': {
      const lines = actionLines(node, slots);
      const label = actionTitle(node);
      const card = actionCard(node, slots);
      if (card.brand === 'Slack' && node.params?.channel) {
        card.brandStyle = 'plain';
        card.summary = slackNotifySummary(node.params.channel);
        card.captionSub = undefined;
      }
      const detail = lines.map((line) => line.text).join(' · ');
      return {
        kind: 'action',
        label,
        subtitle: node.goal,
        lines,
        iconSrc: connectorIconSrc(node.connector),
        tooltip: detail ? `${label} · ${detail}` : label,
        card,
        incomplete: lines.some((line) => !line.complete),
      };
    }
    case 'ai_decision': {
      const ai = aiDisplay(node.goal, node.outputFields);
      return {
        kind: 'ai_decision',
        label: 'AI',
        subtitle: node.goal ?? '내용 분석',
        lines: node.outputFields?.length
          ? node.outputFields.slice(0, 2).map((field) => ({ text: field.description || field.name, complete: true }))
          : [{ text: '결과 형식 정리', complete: Boolean(node.outputFields?.length) }],
        tooltip: node.goal?.trim() || 'AI 판단',
        card: {
          header: 'AI',
          brand: 'AI',
          brandStyle: 'ai',
          summary: ai.summary,
          captionSub: ai.captionSub,
        },
        incomplete: !node.goal?.trim(),
      };
    }
    case 'if':
      return {
        kind: 'if',
        label: 'IF',
        conditionLabel: conditionText(node.condition),
        lines: [{ text: conditionText(node.condition), complete: Boolean(node.condition) }],
        tooltip: conditionText(node.condition),
        card: {
          header: 'Flow',
          brand: 'IF',
          brandStyle: 'bracket',
          summary: truncate(conditionText(node.condition), 26),
        },
        incomplete: !node.condition,
      };
    case 'human_approval':
      return {
        kind: 'human_approval',
        label: '승인',
        subtitle: node.reason ?? '실행 전 확인',
        lines: [],
        tooltip: node.reason?.trim() || '사람 승인',
        card: {
          header: 'Flow',
          brand: 'Approval',
          brandStyle: 'bracket',
          summary: truncate(node.reason ?? '실행 전 확인', 24),
        },
        incomplete: !node.reason?.trim(),
      };
    default:
      return {
        kind: 'action',
        label: '단계',
        lines: [],
        card: {
          header: 'Action',
          brand: 'Step',
          brandStyle: 'bracket',
          summary: '설정 필요',
        },
        incomplete: true,
      };
  }
}

export function editPromptForNode(node: WorkflowNode): string {
  const display = displayForWorkflowNode(node);
  return `${display.label} 단계를 어떻게 바꿀까요?`;
}

export function editPromptForTrigger(): string {
  return '언제 이 업무를 시작할지 어떻게 바꿀까요?';
}

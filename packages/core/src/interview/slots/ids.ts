const NODE_PARAM_SLOT = /^(.+)\.params\.(.+)$/;
const NODE_MEMO_SLOT = /^(.+)\.memo$/;
const NODE_TEXT_SLOT = /^(.+)\.(goal|reason)$/;

const NODE_ROLE_HINTS: Record<string, string> = {
  critical: '긴급(critical)',
  urgent: '긴급',
  high: '운영(high)',
  ops: '운영',
  operational: '운영',
  normal: '보고(normal)',
  report: '보고',
  긴급: '긴급',
  운영: '운영',
  보고: '보고',
};

export function nodeParamSlotId(nodeId: string, paramName: string): string {
  return `${nodeId}.params.${paramName}`;
}

export function nodeMemoSlotId(nodeId: string): string {
  return `${nodeId}.memo`;
}

export function parseNodeParamSlot(slot: string): { nodeId: string; paramName: string } | null {
  const match = NODE_PARAM_SLOT.exec(slot.trim());
  if (!match) return null;
  return { nodeId: match[1]!, paramName: match[2]! };
}

export function parseNodeMemoSlot(slot: string): { nodeId: string } | null {
  const match = NODE_MEMO_SLOT.exec(slot.trim());
  if (!match) return null;
  return { nodeId: match[1]! };
}

export type NodeTextSlotField = 'goal' | 'reason';

export function nodeTextSlotId(nodeId: string, field: NodeTextSlotField): string {
  return `${nodeId}.${field}`;
}

export function parseNodeTextSlot(slot: string): { nodeId: string; field: NodeTextSlotField } | null {
  const match = NODE_TEXT_SLOT.exec(slot.trim());
  if (!match) return null;
  return { nodeId: match[1]!, field: match[2] as NodeTextSlotField };
}

/** Derive a user-facing branch hint from planner node ids like `critical_slack`. */
export function nodeRoleHint(nodeId: string): string | undefined {
  const tokens = nodeId.toLowerCase().split(/[_\-.]+/).filter(Boolean);
  for (const token of tokens) {
    const hint = NODE_ROLE_HINTS[token];
    if (hint) return hint;
  }
  return undefined;
}

export function nodeSlotLabel(nodeId: string, label: string): string {
  const hint = nodeRoleHint(nodeId);
  return hint ? `${hint} · ${label}` : label;
}

/** User-facing chat/panel question — never expose raw node ids like `critical_slack`. */
export function nodeSlotQuestion(nodeId: string, question: string, branchHint?: string): string {
  const hint = branchHint ?? nodeRoleHint(nodeId);
  if (!hint) return question;

  if (/Slack 채널|슬랙 채널/i.test(question)) {
    return `${hint} 알림을 보낼 Slack 채널은 어디인가요?`;
  }
  if (/Gmail|메일|수신자|받는/i.test(question)) {
    return `${hint} 알림을 보낼 메일 주소를 알려주세요.`;
  }
  if (/AI 단계|판단|분류할까요/i.test(question)) {
    return question;
  }
  if (/무슨 내용|메시지/i.test(question)) {
    return question;
  }
  return `${hint}: ${question}`;
}

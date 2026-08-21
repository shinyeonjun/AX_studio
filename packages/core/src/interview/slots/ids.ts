const NODE_PARAM_SLOT = /^(.+)\.params\.(.+)$/;
const NODE_MEMO_SLOT = /^(.+)\.memo$/;
const NODE_TEXT_SLOT = /^(.+)\.(goal|reason)$/;

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

export function nodeSlotLabel(nodeId: string, label: string): string {
  return `${nodeId} · ${label}`;
}

export function nodeSlotQuestion(nodeId: string, question: string): string {
  return `${nodeId} — ${question}`;
}

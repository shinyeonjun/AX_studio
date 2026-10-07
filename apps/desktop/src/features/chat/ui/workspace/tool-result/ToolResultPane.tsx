import type { WorkspaceChatMessage } from '@ax-studio/core';
import { DatabaseResult } from './DatabaseResult';
import { OutcomeResult } from './OutcomeResult';
import { PendingMessageResult } from './PendingMessageResult';
import type { ToolResultPaneProps } from './types';
import './tool-result.css';

export { EditableMessageResult } from './EditableMessageResult';
export { OutcomeResult } from './OutcomeResult';
export type { ToolResultPaneProps } from './types';

export function toolResultMessages(messages: WorkspaceChatMessage[]): WorkspaceChatMessage[] {
  return messages.filter(message => message.role === 'assistant' && (message.approval?.toolResult || message.readResult?.readScope || message.toolSendOutcome));
}

export function ToolResultPane({ message, ...actions }: ToolResultPaneProps) {
  if (message.toolSendOutcome) return <OutcomeResult outcome={message.toolSendOutcome} executionId={message.executionId} />;
  const reference = message.approval?.toolResult;
  if (reference) return <PendingMessageResult key={reference.approvalId} reference={reference} {...actions} />;
  return message.readResult?.readScope ? <DatabaseResult message={message} /> : null;
}

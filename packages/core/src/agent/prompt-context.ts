import type { ChatMessage } from './model/chat.js';
import type { InterviewDraft, WorkflowNode } from '../interview/workflow-schema.js';
import { formatCondition, type ConditionExpr } from '../runtime/condition-expr.js';

export const INTERVIEW_RECENT_MESSAGE_COUNT = 8;
const MESSAGE_SUMMARY_MAX_CHARS = 140;

function truncate(text: string, max = MESSAGE_SUMMARY_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function formatTrigger(workflow: InterviewDraft): string {
  switch (workflow.triggerType) {
    case 'manual':
      return 'manual';
    case 'once':
      return `once runAt=${workflow.runAt ?? '?'}`;
    case 'schedule':
      return `schedule=${workflow.schedule ?? '?'} tz=${workflow.timezone ?? 'Asia/Seoul'}`;
    case 'gmail.new_message':
      return `gmail.new_message account=${workflow.gmailAccount ?? '?'}`;
    case 'slack.new_message':
      return `slack.new_message channel=${workflow.slackChannel ?? '?'}`;
    case 'local_folder.new_file':
      return `local_folder.new_file folderId=${workflow.localFolderId ?? '?'}${workflow.localFolderExtensions ? ` extensions=${workflow.localFolderExtensions}` : ''}`;
    default:
      return workflow.triggerType;
  }
}

function formatNode(node: WorkflowNode): string {
  if (node.type === 'action') {
    const params = Object.entries(node.params ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return `- action ${node.id}: ${node.connector}.${node.action}${params ? ` (${params})` : ''}`;
  }
  if (node.type === 'ai_decision') {
    return `- ai_decision ${node.id}: ${node.goal ?? ''}`.trim();
  }
  if (node.type === 'if') {
    const condition =
      node.condition && typeof node.condition === 'object'
        ? formatCondition(node.condition as ConditionExpr)
        : String(node.condition ?? '');
    return `- if ${node.id}: then=[${(node.thenStepIds ?? []).join(', ')}] else=[${(node.elseStepIds ?? []).join(', ')}] when ${condition}`;
  }
  return `- human_approval ${node.id}: ${node.reason ?? ''}`.trim();
}

/** Compact workflow state for prompts — avoids pretty-printed JSON bloat. */
export function formatWorkflowState(workflow: InterviewDraft): string {
  const lines: string[] = [];
  if (workflow.name.trim()) lines.push(`name: ${workflow.name.trim()}`);
  if (workflow.goal.trim()) lines.push(`goal: ${workflow.goal.trim()}`);
  lines.push(`trigger: ${formatTrigger(workflow)}`);
  if (workflow.success?.trim()) lines.push(`success: ${workflow.success.trim()}`);
  if (workflow.assumptions.length > 0) {
    lines.push(`assumptions: ${workflow.assumptions.join(' | ')}`);
  }
  if (workflow.nodes.length === 0) {
    lines.push('nodes: (없음)');
  } else {
    lines.push('nodes:');
    lines.push(...workflow.nodes.map(formatNode));
  }
  return lines.join('\n');
}

function summarizeMessage(message: ChatMessage): string {
  const label = message.role === 'user' ? '사용자' : '어시스턴트';
  return `${label}: ${truncate(message.content)}`;
}

/** Keep recent turns verbatim; collapse older chat into a short summary block. */
export function windowInterviewMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= INTERVIEW_RECENT_MESSAGE_COUNT) return messages;

  const older = messages.slice(0, -INTERVIEW_RECENT_MESSAGE_COUNT);
  const recent = messages.slice(-INTERVIEW_RECENT_MESSAGE_COUNT);
  const summary = older.map(summarizeMessage).join('\n');

  return [{ role: 'user', content: `[이전 대화 요약]\n${summary}` }, ...recent];
}

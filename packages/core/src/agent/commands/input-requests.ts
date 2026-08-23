import type { AxCommandIssue, AxCommandResult, AxInputRequest } from './schema.js';

const REQUESTABLE_ISSUES = new Set(['invalid_workflow_schema', 'missing_argument']);

function requestType(name: string): AxInputRequest['type'] {
  const normalized = name.toLowerCase();
  if (normalized.includes('email') || normalized.includes('recipient') || normalized === 'to') return 'email';
  if (normalized.includes('channel') || normalized.includes('slack')) return 'slack_channel';
  if (normalized.includes('folder') || normalized.includes('directory')) return 'folder';
  return 'text';
}

function labelFor(name: string): string {
  const labels: Record<string, string> = {
    to: '메일 수신자',
    cc: '참조 수신자',
    bcc: '숨은 참조 수신자',
    subject: '메일 제목',
    text: '메시지 내용',
    channel: 'Slack 채널',
    folderId: '연결 폴더',
    path: '파일 경로',
    workflowId: '워크플로우',
  };
  return labels[name] ?? name;
}

function missingNames(issue: AxCommandIssue): string[] {
  const messageMatch = issue.message.match(/필요한 값이 없습니다:\s*(.+)$/u);
  if (messageMatch) {
    return messageMatch[1]!
      .split(/[,，]/u)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (issue.path?.startsWith('args.')) return [issue.path.slice('args.'.length)];
  return [];
}

function requestFor(issue: AxCommandIssue, name: string, index: number): AxInputRequest {
  const type = requestType(name);
  return {
    id: `ax-input-${issue.path ?? issue.code}-${name}-${index}`,
    label: labelFor(name),
    type,
    required: true,
    ...(type === 'slack_channel' ? { placeholder: '#채널명 또는 채널 ID' } : {}),
    ...(type === 'email' ? { placeholder: 'name@example.com' } : {}),
    ...(type === 'folder' ? { placeholder: '연결된 폴더를 선택하세요' } : {}),
    reason: issue.message,
  };
}

/**
 * Converts host validation issues into renderer data. This is intentionally
 * separate from the transcript: the model still receives the full result,
 * while the user sees a typed control instead of protocol JSON.
 */
export function inputRequestsForResult(result: AxCommandResult): AxInputRequest[] {
  if (result.status !== 'needs_input' && result.status !== 'invalid') return [];
  const requests: AxInputRequest[] = [];
  for (const issue of result.issues) {
    if (!REQUESTABLE_ISSUES.has(issue.code)) continue;
    for (const [index, name] of missingNames(issue).entries()) {
      requests.push(requestFor(issue, name, index));
    }
  }
  return requests.filter((request, index, all) => all.findIndex((candidate) => candidate.id === request.id) === index);
}

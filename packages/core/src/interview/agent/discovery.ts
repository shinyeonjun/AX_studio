import type { AgentHarness } from '../../agent/harness.js';
import type { InterviewAgentContext } from '../../agent/types.js';
import type { ChatMessage } from '../../agent/model/chat.js';
import {
  executeDesignToolCalls,
  formatDesignToolResults,
  type DesignToolContext,
} from '../../design-tools/index.js';
import {
  interviewResultFromOutput,
  isInterviewTerminalResult,
  parseInterviewProviderOutput,
  unwrapInterviewPayload,
  type InterviewAgentResult,
} from './output-schema.js';
import { interviewOutputSchemaForProvider } from './wire-schema.js';
import type { WorkflowPlan } from '../plan/schema.js';
import { ZodError } from 'zod';

export const INTERVIEW_DISCOVERY_MAX_ROUNDS = 5;

const EMPTY_DISCOVER_RETRY_USER =
  'discover 응답에는 toolCalls가 최소 1개 필요합니다. connections.list 또는 sources.list을 호출하세요.';

const INVALID_DISCOVER_RETRY_USER =
  'discover 응답의 toolCalls 형식이 올바르지 않습니다. 허용된 design-tool만 최대 5개까지 호출하세요.';

const PLAN_REQUIRED_RETRY =
  'plan이 없습니다. kind=plan으로 전체 노드 그래프를 먼저 그리세요. 필수 값은 비워 두세요. 연결은 세션 상태에 이미 있습니다.';

const EMPTY_PLAN_RETRY =
  'plan.nodes가 비어 있습니다. kind=plan으로 전체 노드 그래프를 그리세요. 필수 값은 비워 두세요.';

const ACTION_CAPABILITY_RETRY =
  'action 노드에는 catalog의 connector와 action(또는 actionRef)이 필요합니다. params 값은 비워 두어도 됩니다.';

const DISCOVER_AFTER_PLAN_RETRY =
  'plan이 이미 있습니다. discover 하지 말고 kind=patch로 missing_slots만 채우거나, 구조가 바뀌면 replan 하세요.';

const DISCOVER_AGAIN_RETRY =
  'discovery는 이번 턴에서 이미 끝났습니다. 이제 kind=plan으로 그래프를 그리세요.';

function isEmptyDiscoverPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
  const toolCalls = record.toolCalls;
  const emptyToolCalls = !Array.isArray(toolCalls) || toolCalls.length === 0;
  const emptyToolCallsString =
    typeof record.toolCalls === 'string' && !record.toolCalls.trim();
  return kind === 'discover' && (emptyToolCalls || emptyToolCallsString);
}

function isDiscoverPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
  if (kind === 'discover') return true;
  if (typeof record.toolCalls === 'string' && record.toolCalls.trim()) return true;
  return Array.isArray(record.toolCalls) && record.toolCalls.length > 0 && !record.nextQuestion;
}

function hasDesignToolResults(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.role === 'assistant' && message.content.startsWith('[design-tools]'));
}

function planStructureIssue(plan: WorkflowPlan): string | null {
  const nodes = plan.nodes ?? [];
  const notifyActions = nodes.filter(
    (node) =>
      node.type === 'action' &&
      ((node.connector === 'slack' && /message\.send|send/.test(node.action ?? '')) ||
        (node.connector === 'gmail' && /message\.send|send/.test(node.action ?? ''))),
  );
  const notifyCount = notifyActions.length;
  const hasDecision = nodes.some((node) => node.type === 'ai_decision');
  const hasBranch = nodes.some((node) => node.type === 'if');

  if (notifyCount >= 2 && (!hasDecision || !hasBranch)) {
    return '알림 목적지가 여러 개면 document.ingest → ai_decision(분류) → if 분기 → 각 Slack/Gmail action 순으로 plan을 그리세요.';
  }

  if (notifyCount >= 2 && hasBranch) {
    const entries = new Set<string>();
    for (const node of nodes) {
      if (node.type !== 'if') continue;
      node.thenStepIds?.forEach((id) => entries.add(id));
      node.elseStepIds?.forEach((id) => entries.add(id));
    }
    if (notifyActions.some((node) => !entries.has(node.id))) {
      return 'Slack/Gmail 알림 노드는 if의 thenStepIds/elseStepIds에 넣으세요. critical/high/normal은 if를 중첩하거나 else로 이어서 분기하세요.';
    }
  }

  return null;
}

function planHasActionWithoutCapability(plan: WorkflowPlan): boolean {
  return plan.nodes.some((node) => {
    if (node.type !== 'action') return false;
    if (node.actionRef?.trim()) return false;
    return !node.connector?.trim() || !node.action?.trim();
  });
}

function retryAsUser(messages: ChatMessage[], assistantNote: string, user: string): void {
  messages.push({ role: 'assistant', content: assistantNote }, { role: 'user', content: user });
}

function discoverParseRetryMessage(err: unknown): string | undefined {
  if (!(err instanceof ZodError)) return undefined;
  if (!err.issues.some((issue) => issue.path[0] === 'toolCalls')) return undefined;
  return INVALID_DISCOVER_RETRY_USER;
}

export interface InterviewDiscoveryRun {
  harness: AgentHarness;
  context: InterviewAgentContext;
  designToolContext: DesignToolContext;
  messages: ChatMessage[];
  sessionId?: string;
  onProgress?: (event: { message: string }) => void;
}

export async function runInterviewDiscoveryLoop(
  run: InterviewDiscoveryRun,
): Promise<InterviewAgentResult> {
  const discoveryMessages: ChatMessage[] = [];
  const outputSchema = interviewOutputSchemaForProvider(run.harness.providerName);

  for (let round = 0; round < INTERVIEW_DISCOVERY_MAX_ROUNDS; round += 1) {
    const phase = round === 0 ? 'interview_turn' : `interview_discover_${round}`;
    run.onProgress?.({
      message: round === 0 ? '업무 요청을 이해하고 있습니다…' : '업무 흐름을 정리하고 있습니다…',
    });
    const { output } = await run.harness.run({
      role: 'interview',
      outputSchema,
      context: run.context,
      sessionId: run.sessionId,
      onProgress: run.onProgress,
      messages: [...run.messages, ...discoveryMessages],
      logContext: phase,
    });

    let parsed;
    try {
      parsed = parseInterviewProviderOutput(run.harness.providerName, output);
    } catch (err) {
      if (isEmptyDiscoverPayload(unwrapInterviewPayload(output))) {
        discoveryMessages.push(
          {
            role: 'assistant',
            content: '[invalid discover output: toolCalls must contain at least one call]',
          },
          { role: 'user', content: EMPTY_DISCOVER_RETRY_USER },
        );
        continue;
      }
      const retryMessage = discoverParseRetryMessage(err);
      if (retryMessage && isDiscoverPayload(unwrapInterviewPayload(output))) {
        discoveryMessages.push(
          { role: 'assistant', content: '[invalid discover output: toolCalls validation failed]' },
          { role: 'user', content: retryMessage },
        );
        continue;
      }
      throw err;
    }

    if (parsed.kind === 'discover') {
      if (run.context.partialPlan || run.context.workflow.nodes.length > 0) {
        retryAsUser(discoveryMessages, '[discover skipped: plan already exists]', DISCOVER_AFTER_PLAN_RETRY);
        continue;
      }
      if (hasDesignToolResults(discoveryMessages)) {
        retryAsUser(discoveryMessages, '[discover skipped: already ran this turn]', DISCOVER_AGAIN_RETRY);
        continue;
      }
      run.onProgress?.({ message: '연결·리소스를 확인하고 있습니다…' });
      const results = await executeDesignToolCalls(parsed.toolCalls, run.designToolContext);
      discoveryMessages.push(
        {
          role: 'assistant',
          content: `[design-tools]\n${JSON.stringify(parsed.toolCalls, null, 2)}`,
        },
        {
          role: 'user',
          content: `[design-tool results]\n${formatDesignToolResults(results)}`,
        },
      );
      continue;
    }

    if (parsed.kind === 'patch' && !run.context.partialPlan && run.context.workflow.nodes.length === 0) {
      retryAsUser(discoveryMessages, '[patch skipped: plan is required first]', PLAN_REQUIRED_RETRY);
      continue;
    }

    if ((parsed.kind === 'plan' || parsed.kind === 'replan') && parsed.plan.nodes.length === 0) {
      retryAsUser(discoveryMessages, '[plan skipped: nodes required]', EMPTY_PLAN_RETRY);
      continue;
    }

    if ((parsed.kind === 'plan' || parsed.kind === 'replan') && planHasActionWithoutCapability(parsed.plan)) {
      retryAsUser(discoveryMessages, '[plan skipped: action capability required]', ACTION_CAPABILITY_RETRY);
      continue;
    }

    const structureIssue =
      (parsed.kind === 'plan' || parsed.kind === 'replan') ? planStructureIssue(parsed.plan) : null;
    if (structureIssue) {
      retryAsUser(discoveryMessages, '[plan skipped: branch structure required]', structureIssue);
      continue;
    }

    if (isInterviewTerminalResult(parsed)) {
      return interviewResultFromOutput(parsed);
    }

    throw new Error(`Unsupported interview output kind: ${(parsed as { kind?: string }).kind ?? 'unknown'}`);
  }

  throw new Error(`Interview discovery exceeded ${INTERVIEW_DISCOVERY_MAX_ROUNDS} rounds`);
}

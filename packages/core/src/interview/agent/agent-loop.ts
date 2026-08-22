import type { AgentHarness } from '../../agent/harness.js';
import type { ChatMessage } from '../../agent/model/chat.js';
import type { InterviewAgentContext } from '../../agent/types.js';
import {
  executeDesignToolCalls,
  formatDesignToolResults,
  type DesignToolContext,
} from '../../design-tools/index.js';
import { MAX_DESIGN_TOOL_CALLS_PER_TURN } from '../../design-tools/types.js';
import {
  agenticInterviewOutputSchemaForProvider,
  parseAgenticInterviewOutput,
  withCurrentPatchRevision,
  type AgenticInterviewOutput,
} from './agent-schema.js';

export const AGENTIC_INTERVIEW_MAX_ROUNDS = 5;

export interface AgenticInterviewRun {
  harness: AgentHarness;
  context: InterviewAgentContext;
  designToolContext: DesignToolContext;
  messages: ChatMessage[];
  sessionId?: string;
  onProgress?: (event: { message: string }) => void;
  draftRevision: number;
}

export type AgenticInterviewResult =
  | Extract<AgenticInterviewOutput, { kind: 'patch' }>
  | Extract<AgenticInterviewOutput, { kind: 'reply' }>;

function toolMessages(
  calls: unknown,
  results: string,
): ChatMessage[] {
  return [
    { role: 'assistant', content: `[workflow agent tools]\n${JSON.stringify(calls)}` },
    { role: 'user', content: `[workflow agent tool results]\n${results}` },
  ];
}

/**
 * Agentic authoring loop. It can inspect state and connected resources, but its
 * only mutating output is a typed draft patch returned to the session layer.
 */
export async function runAgenticInterviewLoop(
  run: AgenticInterviewRun,
): Promise<AgenticInterviewResult> {
  const loopMessages = [...run.messages];

  for (let round = 0; round < AGENTIC_INTERVIEW_MAX_ROUNDS; round += 1) {
    run.onProgress?.({
      message: round === 0 ? '업무와 연결된 도구를 확인하고 있습니다…' : '워크플로우 초안을 다듬고 있습니다…',
    });

    let output: AgenticInterviewOutput;
    try {
      const result = await run.harness.run({
        role: 'interview',
        outputSchema: agenticInterviewOutputSchemaForProvider(run.harness.providerName),
        context: run.context,
        sessionId: run.sessionId,
        onProgress: run.onProgress,
        messages: loopMessages,
        logContext: round === 0 ? 'workflow_agent' : `workflow_agent_retry_${round}`,
      });
      output = parseAgenticInterviewOutput(run.harness.providerName, result.output);
    } catch (error) {
      if (round + 1 >= AGENTIC_INTERVIEW_MAX_ROUNDS) throw error;
      loopMessages.push(
        { role: 'assistant', content: '[workflow agent output rejected]' },
        {
          role: 'user',
          content: '출력 형식이 올바르지 않습니다. tools, patch, reply 중 하나만 반환하고 JSON 계약을 지키세요.',
        },
      );
      continue;
    }

    if (output.kind === 'patch') {
      return withCurrentPatchRevision(output, run.draftRevision);
    }
    if (output.kind === 'reply') return output;

    if (output.toolCalls.length > MAX_DESIGN_TOOL_CALLS_PER_TURN) {
      throw new Error(`too_many_workflow_agent_tools:${MAX_DESIGN_TOOL_CALLS_PER_TURN}`);
    }
    run.onProgress?.({ message: '연결된 리소스를 조회하고 있습니다…' });
    const results = await executeDesignToolCalls(output.toolCalls, run.designToolContext);
    loopMessages.push(...toolMessages(output.toolCalls, formatDesignToolResults(results)));
  }

  return {
    kind: 'reply',
    message: '워크플로우 초안을 완성하지 못했습니다. 요청을 조금 더 구체적으로 알려주세요.',
  };
}

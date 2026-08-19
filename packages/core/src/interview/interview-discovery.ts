import type { AgentHarness } from '../agent/harness.js';
import type { InterviewAgentContext } from '../agent/types.js';
import type { ChatMessage } from '../agent/model/chat.js';
import {
  executeDesignToolCalls,
  formatDesignToolResults,
  type DesignToolContext,
} from '../design-tools/index.js';
import {
  InterviewAgentModelSchema,
  interviewTurnFromAgentOutput,
  parseInterviewAgentOutput,
  type InterviewDesignOutput,
} from './interview-agent-schema.js';
import type { InterviewTurn } from './workflow-schema.js';

export const INTERVIEW_DISCOVERY_MAX_ROUNDS = 5;

export interface InterviewDiscoveryRun {
  harness: AgentHarness;
  context: InterviewAgentContext;
  designToolContext: DesignToolContext;
  messages: ChatMessage[];
  sessionId?: string;
  onProgress?: (event: { message: string }) => void;
}

export async function runInterviewDiscoveryLoop(run: InterviewDiscoveryRun): Promise<InterviewTurn> {
  const discoveryMessages: ChatMessage[] = [];

  for (let round = 0; round < INTERVIEW_DISCOVERY_MAX_ROUNDS; round += 1) {
    const { output } = await run.harness.run({
      role: 'interview',
      outputSchema: InterviewAgentModelSchema,
      context: run.context,
      sessionId: run.sessionId,
      onProgress: run.onProgress,
      messages: [...run.messages, ...discoveryMessages],
    });

    const parsed = parseInterviewAgentOutput(output);
    if (parsed.kind === 'discover') {
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

    return interviewTurnFromAgentOutput(parsed as InterviewDesignOutput);
  }

  throw new Error(`Interview discovery exceeded ${INTERVIEW_DISCOVERY_MAX_ROUNDS} rounds`);
}

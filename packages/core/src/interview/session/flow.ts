import type { WorkflowIR } from '../../workflow/schema.js';
import type { AgentHarness } from '../../agent/harness.js';
import { windowInterviewMessages } from '../../agent/prompt-context.js';
import type { DesignToolContext } from '../../design-tools/types.js';
import { runInterviewDiscoveryLoop } from '../agent/discovery.js';
import { buildIRFromWorkflow, UnknownCapabilityError } from '../compile/builder.js';
import { buildInterviewSessionHints } from '../draft/local-folder.js';
import {
  buildConnectedResourcesFromConnections,
  formatConnectedResourcesForPrompt,
} from '../resources/connected-resources.js';
import { buildInterviewTurnHints } from '../slots/prompts.js';
import { createInterviewState, hydrateInterviewState, type InterviewState, type WorkScope } from './state.js';
import { buildWorkflowFromSession } from './merge-workflow.js';
import {
  assessSessionCompleteness,
  finalizeCompleteness,
} from './completeness.js';
import { buildAssistantMessage, sessionStatus } from './messages.js';
import { workScopeSessionHint } from './work-scope.js';

export interface InterviewRunOptions {
  harness: AgentHarness;
  connectedConnectors?: string[];
  designToolContext: DesignToolContext;
  onProgress?: (event: { message: string }) => void;
}

async function runInterviewTurn(state: InterviewState, options: InterviewRunOptions): Promise<InterviewState> {
  const connectedConnectors = options.connectedConnectors ?? [];
  const resources = buildConnectedResourcesFromConnections(options.designToolContext.connections);
  const hydrated = hydrateInterviewState(state);
  const priorCompleteness = assessSessionCompleteness(hydrated, connectedConnectors);

  const result = await runInterviewDiscoveryLoop({
    harness: options.harness,
    designToolContext: options.designToolContext,
    sessionId: hydrated.sessionId,
    onProgress: options.onProgress,
    messages: windowInterviewMessages(hydrated.messages),
    context: {
      workflow: hydrated.workflow,
      partialPlan: hydrated.partialPlan,
      slotValues: hydrated.slotValues,
      completeness: priorCompleteness,
      connectedConnectors,
      connectedResources: formatConnectedResourcesForPrompt(resources),
      sessionHints: buildInterviewTurnHints({
        sessionHints: [
          buildInterviewSessionHints(hydrated.messages, hydrated.userInstruction, hydrated.workScope),
          workScopeSessionHint(hydrated.workScope),
        ]
          .filter(Boolean)
          .join('\n'),
        hasPartialPlan: Boolean(hydrated.partialPlan) || hydrated.workflow.nodes.length > 0,
        missingRequired: priorCompleteness.missingRequired,
        workScope: hydrated.workScope,
      }),
      nowIso: new Date().toISOString(),
    },
  });

  const merged = buildWorkflowFromSession(hydrated, result, resources);
  const workflow = merged.workflow;

  let built: ReturnType<typeof buildIRFromWorkflow>;
  let compileMessage = result.nextQuestion;
  try {
    built = buildIRFromWorkflow(workflow);
  } catch (error) {
    // A malformed graph is a programmer or model contract error. Do not turn it
    // into an apparently valid partial workflow. An unknown capability is
    // different: the user can correct it in the next turn, so explain the
    // catalog error in the conversation while preserving the partial plan.
    if ((error as { code?: string })?.code === 'workflow_graph_invalid') {
      throw error;
    }
    if (error instanceof UnknownCapabilityError) {
      compileMessage = `${error.message} 사용 가능한 연결과 작업으로 다시 정해 주세요.`;
    }
    const completeness = assessSessionCompleteness(
      {
        ...hydrated,
        workflow,
        slotValues: merged.slotValues,
        partialPlan: merged.partialPlan,
      },
      connectedConnectors,
    );
    const assistantMsg = buildAssistantMessage(
      compileMessage,
      completeness,
      false,
      hydrated.workScope,
    );
    return {
      ...hydrated,
      workflow,
      slotValues: merged.slotValues,
      partialPlan: merged.partialPlan,
      status: sessionStatus(false, false, Boolean(merged.partialPlan) || workflow.nodes.length > 0),
      completeness,
      done: false,
      messages: [...hydrated.messages, { role: 'assistant', content: assistantMsg }],
    };
  }

  const { completeness, deployable } = finalizeCompleteness(
    built,
    workflow,
    connectedConnectors,
    hydrated.workScope,
  );
  const finalized = deployable;
  const assistantMsg = buildAssistantMessage(
    result.nextQuestion,
    completeness,
    deployable,
    hydrated.workScope,
  );

  return {
    ...hydrated,
    workflow,
    slotValues: merged.slotValues,
    partialPlan: merged.partialPlan,
    draft: built,
    completeness,
    status: sessionStatus(deployable, finalized, Boolean(merged.partialPlan) || workflow.nodes.length > 0),
    done: finalized,
    messages: [...hydrated.messages, { role: 'assistant', content: assistantMsg }],
  };
}

export async function startInterview(
  instruction: string,
  options: InterviewRunOptions,
  workScope: WorkScope,
): Promise<InterviewState> {
  const state = createInterviewState(instruction.trim(), workScope);
  return runInterviewTurn(state, options);
}

export async function applyAnswer(
  state: InterviewState,
  answer: string,
  options: InterviewRunOptions,
): Promise<InterviewState> {
  const hydrated = hydrateInterviewState(state);
  const next: InterviewState = {
    ...hydrated,
    messages: [...hydrated.messages, { role: 'user', content: answer.trim() }],
  };
  return runInterviewTurn(next, options);
}

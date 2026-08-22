import type { WorkflowIR } from '../../workflow/schema.js';
import type { AgentHarness } from '../../agent/harness.js';
import { windowInterviewMessages } from '../../agent/prompt-context.js';
import type { DesignToolContext } from '../../design-tools/types.js';
import { runAgenticInterviewLoop, type AgenticInterviewResult } from '../agent/agent-loop.js';
import { applyAgentDraftPatch } from './apply-agent-patch.js';
import { buildIRFromWorkflow, UnknownCapabilityError } from '../compile/builder.js';
import { buildInterviewSessionHints } from '../draft/local-folder.js';
import {
  buildConnectedResourcesFromConnections,
  formatConnectedResourcesForPrompt,
} from '../resources/connected-resources.js';
import { buildInterviewTurnHints } from '../slots/prompts.js';
import { createInterviewState, hydrateInterviewState, type InterviewState, type WorkScope } from './state.js';
import {
  assessGraphInvalidCompleteness,
  assessSessionCompleteness,
  finalizeCompleteness,
} from './completeness.js';
import { buildAssistantMessage, chatMissingSlots, sessionStatus, shouldFinalizeInterview } from './messages.js';
import { workScopeSessionHint } from './work-scope.js';

export interface InterviewRunOptions {
  harness: AgentHarness;
  connectedConnectors?: string[];
  designToolContext: DesignToolContext;
  onProgress?: (event: { message: string }) => void;
}

function looksLikeModelQuestion(message: string): boolean {
  return /[?？]\s*$/.test(message.trim());
}

/**
 * The model may add a short acknowledgement, but the code-owned completeness
 * result always supplies the actual next question. This prevents the model
 * from inventing slots or declaring the workflow complete.
 */
function composeAssistantMessage(agentMessage: string, codeMessage: string, deployable: boolean): string {
  if (deployable || !agentMessage.trim() || looksLikeModelQuestion(agentMessage)) return codeMessage;
  if (agentMessage.trim() === codeMessage.trim()) return codeMessage;
  return `${agentMessage.trim()}\n\n${codeMessage}`;
}

function workflowContext(
  designToolContext: DesignToolContext,
  hydrated: ReturnType<typeof hydrateInterviewState>,
  completeness: ReturnType<typeof assessSessionCompleteness>,
): DesignToolContext {
  return {
    ...designToolContext,
    workflow: {
      revision: hydrated.draftRevision,
      draft: hydrated.workflow,
      completeness,
    },
  };
}

function contextForAgent(
  hydrated: ReturnType<typeof hydrateInterviewState>,
  priorCompleteness: ReturnType<typeof assessSessionCompleteness>,
  connectedConnectors: string[],
  connectedResources: string,
) {
  return {
    workflow: hydrated.workflow,
    draftRevision: hydrated.draftRevision,
    slotValues: hydrated.slotValues,
    completeness: priorCompleteness,
    connectedConnectors,
    connectedResources,
    sessionHints: buildInterviewTurnHints({
      sessionHints: [
        buildInterviewSessionHints(hydrated.messages, hydrated.userInstruction, hydrated.workScope),
        workScopeSessionHint(hydrated.workScope),
      ]
        .filter(Boolean)
        .join('\n'),
      hasDraft: hydrated.workflow.nodes.length > 0,
      missingRequired: chatMissingSlots(priorCompleteness, hydrated.workScope).map((slot) => slot.slot),
      workScope: hydrated.workScope,
    }),
    nowIso: new Date().toISOString(),
  };
}

function stateWithAssistantMessage(
  state: InterviewState,
  workflow: InterviewState['workflow'],
  slotValues: Record<string, unknown>,
  completeness: InterviewState['completeness'],
  content: string,
  deployable = false,
  draft: Partial<WorkflowIR> = state.draft,
): InterviewState {
  const hasPlan = workflow.nodes.length > 0;
  const finalized = shouldFinalizeInterview(deployable);
  return {
    ...state,
    workflow,
    slotValues,
    draft,
    completeness,
    status: sessionStatus(deployable, finalized, hasPlan),
    done: finalized,
    messages: [...state.messages, { role: 'assistant', content }],
  };
}

function resultMessage(result: AgenticInterviewResult): string {
  return result.message;
}

async function runInterviewTurn(state: InterviewState, options: InterviewRunOptions): Promise<InterviewState> {
  const connectedConnectors = options.connectedConnectors ?? [];
  const resources = buildConnectedResourcesFromConnections(options.designToolContext.connections);
  const hydrated = hydrateInterviewState(state);
  const priorCompleteness = assessSessionCompleteness(hydrated, connectedConnectors);
  const authoringToolContext = workflowContext(options.designToolContext, hydrated, priorCompleteness);

  const result = await runAgenticInterviewLoop({
    harness: options.harness,
    designToolContext: authoringToolContext,
    sessionId: hydrated.sessionId,
    onProgress: options.onProgress,
    messages: windowInterviewMessages(hydrated.messages),
    context: contextForAgent(
      hydrated,
      priorCompleteness,
      connectedConnectors,
      formatConnectedResourcesForPrompt(resources),
    ),
    draftRevision: hydrated.draftRevision,
  });

  let current = hydrated;
  let agentMessage = resultMessage(result);
  if (result.kind === 'patch') {
    try {
      const applied = applyAgentDraftPatch(current, result.patch, authoringToolContext);
      current = applied.state;
      agentMessage = applied.message;
    } catch (error) {
      // A model patch is never allowed to turn into an IPC failure or a side
      // effect. Keep the previous draft and let the deterministic validator
      // ask the next authoritative question.
      agentMessage =
        (error as { code?: string }).code === 'workflow_revision_conflict'
          ? '초안이 다른 변경으로 갱신되어 최신 상태를 기준으로 다시 확인합니다.'
          : '초안 패치를 검수하지 못해 현재 초안을 유지했습니다.';
    }
  }

  const workflow = current.workflow;
  let built: ReturnType<typeof buildIRFromWorkflow>;
  try {
    built = buildIRFromWorkflow(workflow);
  } catch (error) {
    if ((error as { code?: string })?.code === 'workflow_graph_invalid') {
      const completeness = assessGraphInvalidCompleteness(current, connectedConnectors);
      const codeMessage = buildAssistantMessage('', completeness, false, current.workScope);
      return stateWithAssistantMessage(
        current,
        workflow,
        current.slotValues,
        completeness,
        composeAssistantMessage(agentMessage, codeMessage, false),
      );
    }

    const compileMessage =
      error instanceof UnknownCapabilityError
        ? `${error.message} 사용 가능한 연결과 작업으로 다시 정해 주세요.`
        : '';
    const completeness = assessSessionCompleteness(current, connectedConnectors);
    const codeMessage = buildAssistantMessage('', completeness, false, current.workScope, compileMessage);
    return stateWithAssistantMessage(
      current,
      workflow,
      current.slotValues,
      completeness,
      composeAssistantMessage(agentMessage, codeMessage, false),
    );
  }

  const { completeness, deployable } = finalizeCompleteness(
    built,
    workflow,
    connectedConnectors,
    current.workScope,
  );
  const draftIr =
    typeof current.draft.allowExternalAuto === 'boolean'
      ? { ...built, allowExternalAuto: current.draft.allowExternalAuto }
      : built;
  const codeMessage = buildAssistantMessage('', completeness, deployable, current.workScope);
  return stateWithAssistantMessage(
    current,
    workflow,
    current.slotValues,
    completeness,
    composeAssistantMessage(agentMessage, codeMessage, deployable),
    deployable,
    draftIr,
  );
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

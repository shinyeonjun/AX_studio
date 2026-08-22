import { useEffect, useRef, useState, useMemo } from 'react';
import type { CompletenessResult, InterviewDraft, WorkScope, WorkflowIR } from '@ax-studio/core';
import { isRunConfirmationMessage } from '@ax-studio/core/interview-messages';
import { parseWorkspaceCommand } from '../lib/parse-slash-command';
import {
  appendAssistantMessage,
  cloneInterviewDraft,
  emptyInterviewDraftBaseline,
  executionResultMessage,
  hydrateInterviewSummary,
  interviewErrorMessage,
  interviewSessionTitle,
  isAffirmativeRunIntent,
  isDeferredOnce,
  isImmediateOnce,
  isRecurringDraft,
  type InterviewState,
} from './interview-helpers';
import type { WorkspaceChatMessage } from '../components/workspace/AxWorkspaceChat';

export type { WorkScope } from '@ax-studio/core';
export type { InterviewState } from './interview-helpers';
export { isDeferredOnce, isImmediateOnce, isRecurringDraft } from './interview-helpers';

export interface UseInterviewOptions {
  refresh: () => Promise<void>;
  onSessionsChanged?: () => void;
}

export function useInterview({ refresh, onSessionsChanged }: UseInterviewOptions) {
  const sessionEpochRef = useRef(0);
  const savedWorkflowIdRef = useRef<string | undefined>(undefined);
  const workspaceSessionIdRef = useRef<string | undefined>(undefined);
  const actionInFlightRef = useRef(false);
  const [workspaceSessionId, setWorkspaceSessionId] = useState<string | undefined>();
  const [chatMessages, setChatMessages] = useState<WorkspaceChatMessage[]>([]);
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [editHint, setEditHint] = useState<string | null>(null);
  const [workflowBaseline, setWorkflowBaseline] = useState<InterviewDraft | undefined>();
  const [turnDiffBaseline, setTurnDiffBaseline] = useState<InterviewDraft | undefined>();
  const [allowExternalAuto, setAllowExternalAuto] = useState(false);

  useEffect(() => {
    const off = window.ax.onChatProgress?.(({ message }) => setProgress(message));
    return () => off?.();
  }, []);

  const isCurrentSession = (epoch: number) => epoch === sessionEpochRef.current;

  const invalidateSession = () => {
    sessionEpochRef.current += 1;
  };

  const reset = () => {
    invalidateSession();
    savedWorkflowIdRef.current = undefined;
    workspaceSessionIdRef.current = undefined;
    setWorkspaceSessionId(undefined);
    actionInFlightRef.current = false;
    setInterview(null);
    setChatMessages([]);
    setSaved(false);
    setBusy(false);
    setError('');
    setProgress('');
    setEditHint(null);
    setWorkflowBaseline(undefined);
    setTurnDiffBaseline(undefined);
    setAllowExternalAuto(false);
  };

  const displayMessages: WorkspaceChatMessage[] = interview?.messages ?? chatMessages;

  const startNewChat = () => {
    reset();
  };

  const loadWorkspaceChat = async (id: string) => {
    invalidateSession();
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setInterview(null);
    try {
      const loaded = await window.ax.loadWorkspaceChat(id);
      if (!isCurrentSession(epoch)) return;
      workspaceSessionIdRef.current = loaded.id;
      setWorkspaceSessionId(loaded.id);
      setChatMessages(loaded.messages);
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const openWorkChat = async (workflowId: string) => {
    invalidateSession();
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setChatMessages([]);
    setInterview(null);
    workspaceSessionIdRef.current = undefined;
    setWorkspaceSessionId(undefined);
    try {
      const loaded = await window.ax.loadWorkChat(workflowId);
      if (!isCurrentSession(epoch)) return;
      const state = await hydrateInterviewSummary({
        ...(loaded.state as InterviewState),
        summary: loaded.summary,
        title: loaded.title,
        workflowId,
      });
      if (!isCurrentSession(epoch)) return;
      setInterview({ ...state, title: interviewSessionTitle(state) });
      if (state.workflow) {
        const snapshot = cloneInterviewDraft(state.workflow);
        setWorkflowBaseline(snapshot);
        setTurnDiffBaseline(snapshot);
      }
      savedWorkflowIdRef.current = workflowId;
      setSaved(true);
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const openInterviewChat = async (sessionId: string) => {
    invalidateSession();
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setChatMessages([]);
    setInterview(null);
    workspaceSessionIdRef.current = undefined;
    setWorkspaceSessionId(undefined);
    try {
      const loaded = await window.ax.loadInterviewChat(sessionId);
      if (!isCurrentSession(epoch)) return;
      const state = await hydrateInterviewSummary({
        ...(loaded.state as InterviewState),
        summary: loaded.summary,
        title: loaded.title,
      });
      if (!isCurrentSession(epoch)) return;
      setInterview({ ...state, title: interviewSessionTitle(state) });
      if (state.workflow) {
        const snapshot = cloneInterviewDraft(state.workflow);
        setWorkflowBaseline(snapshot);
        setTurnDiffBaseline(snapshot);
      }
      savedWorkflowIdRef.current = state.workflowId;
      setSaved(Boolean(state.workflowId));
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const startInterview = async (instruction: string, workScope: WorkScope) => {
    const text = instruction.trim();
    if (!text || busy) return;
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setProgress('업무 흐름을 설계하고 있습니다');
    setSaved(false);
    savedWorkflowIdRef.current = undefined;
    actionInFlightRef.current = false;
    setWorkflowBaseline(emptyInterviewDraftBaseline());
    setTurnDiffBaseline(emptyInterviewDraftBaseline());
    setChatMessages([]);
    setInterview({ messages: [{ role: 'user', content: text }], title: '새 업무', workScope });
    try {
      const res = await window.ax.startInterview(text, workScope);
      if (!isCurrentSession(epoch)) return;
      const next = res as InterviewState & { draft?: unknown };
      if (next.done && next.draft) {
        const summary = await window.ax.summarize(next.draft);
        if (!isCurrentSession(epoch)) return;
        setInterview({ ...next, summary, title: interviewSessionTitle(next) });
      } else {
        setInterview({ ...next, title: interviewSessionTitle(next) });
      }
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setInterview(null);
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const sendChat = async (text: string) => {
    const epoch = sessionEpochRef.current;
    const nextMessages: WorkspaceChatMessage[] = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(nextMessages);
    setBusy(true);
    setError('');
    setProgress('연결된 리소스를 확인하고 있습니다');
    try {
      const res = (await window.ax.sendChat(nextMessages)) as {
        role: 'assistant';
        content: string;
      };
      if (!isCurrentSession(epoch)) return;
      const finalMessages: WorkspaceChatMessage[] = [
        ...nextMessages,
        { role: 'assistant', content: res.content },
      ];
      setChatMessages(finalMessages);
      const saved = await window.ax.saveWorkspaceChat(workspaceSessionIdRef.current, finalMessages);
      if (!isCurrentSession(epoch)) return;
      workspaceSessionIdRef.current = saved.id;
      setWorkspaceSessionId(saved.id);
      onSessionsChanged?.();
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const sendAnswer = async (content: string) => {
    if (!interview || !content.trim() || busy || actionInFlightRef.current) return;
    const prior = interview;
    const deployable = Boolean(prior.completeness?.deployable);
    const lastAssistant = [...(prior.messages ?? [])].reverse().find((message) => message.role === 'assistant');
    const wantsRun =
      deployable &&
      isAffirmativeRunIntent(content) &&
      (prior.done || (lastAssistant ? isRunConfirmationMessage(lastAssistant.content) : false));

    if (wantsRun && prior.draft && isImmediateOnce(prior.draft)) {
      setEditHint(null);
      await runOnce();
      return;
    }

    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    setProgress('답변을 준비하고 있습니다');
    setEditHint(null);
    setTurnDiffBaseline(
      prior.workflow ? cloneInterviewDraft(prior.workflow as InterviewDraft) : emptyInterviewDraftBaseline(),
    );
    setInterview({
      ...prior,
      done: false,
      summary: undefined,
      messages: [...(prior.messages ?? []), { role: 'user', content: content.trim() }],
    });
    try {
      const res = await window.ax.applyAnswer(prior, content.trim());
      if (!isCurrentSession(epoch)) return;
      const next = res as InterviewState & { draft?: unknown };
      if (next.done && next.draft) {
        const summary = await window.ax.summarize(next.draft);
        if (!isCurrentSession(epoch)) return;
        setInterview({ ...next, summary, title: interviewSessionTitle(next) });
      } else {
        setInterview({ ...next, title: interviewSessionTitle(next) });
      }
      if (next.workflowId) await refresh();
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      if (isCurrentSession(epoch)) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy) return;
    setError('');

    if (interview) {
      await sendAnswer(text);
      return;
    }

    const command = parseWorkspaceCommand(text);
    if (command.mode === 'once') {
      if (!command.instruction) {
        setError('/once 뒤에 실행할 업무를 입력해 주세요.');
        return;
      }
      await startInterview(command.instruction, 'once');
      return;
    }
    if (command.mode === 'workflow') {
      if (!command.instruction) {
        setError('/workflow 뒤에 자동화할 업무를 입력해 주세요.');
        return;
      }
      await startInterview(command.instruction, 'recurring');
      return;
    }
    await sendChat(command.text);
  };

  const approvalGates = useMemo(() => {
    const draft = interview?.draft as Partial<WorkflowIR> | undefined;
    if (!draft?.steps) return null;
    let externalCount = 0;
    let highRiskCount = 0;
    for (const step of draft.steps) {
      if (step.type !== 'action') continue;
      if (step.sideEffect === 'EXTERNAL') externalCount += 1;
      if (step.sideEffect === 'EXTERNAL_HIGH') highRiskCount += 1;
    }
    return { externalCount, highRiskCount };
  }, [interview?.draft]);

  useEffect(() => {
    if (typeof interview?.draft?.allowExternalAuto === 'boolean') {
      setAllowExternalAuto(interview.draft.allowExternalAuto);
    }
  }, [interview?.draft?.allowExternalAuto]);

  const draftWithApprovalPolicy = (draft: unknown) => {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return draft;
    return { ...(draft as Record<string, unknown>), allowExternalAuto };
  };

  const persistDraftWork = async (
    draft: unknown,
    prior: InterviewState,
    epoch: number,
  ): Promise<string | undefined> => {
    const existingId = prior.workflowId ?? savedWorkflowIdRef.current;
    const payload =
      existingId && draft && typeof draft === 'object' && !Array.isArray(draft)
        ? { ...(draft as Record<string, unknown>), id: existingId }
        : draft;
    const savedWork = (await window.ax.saveWorkflow(payload)) as { workflowId: string };
    if (!isCurrentSession(epoch)) return undefined;
    savedWorkflowIdRef.current = savedWork.workflowId;
    return savedWork.workflowId;
  };

  const runOnce = async () => {
    if (!interview?.draft || busy || actionInFlightRef.current) return;
    const prior = interview;
    const epoch = sessionEpochRef.current;
    actionInFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await window.ax.runEphemeral(draftWithApprovalPolicy(prior.draft));
      if (!isCurrentSession(epoch)) return;
      await refresh();
      if (!isCurrentSession(epoch)) return;
      const next = appendAssistantMessage(prior, executionResultMessage(result));
      await window.ax.saveChatSession(next, next.summary, next.workflowId);
      if (!isCurrentSession(epoch)) return;
      setInterview({ ...next, title: interviewSessionTitle(next) });
      onSessionsChanged?.();
      if (result.status === 'failed' || result.status === 'cancelled') {
        const code = result.errorCode ?? result.status;
        setError(`실행에 실패했습니다 (${code}). 활동 탭에서 자세한 내용을 확인해 주세요.`);
      }
    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      actionInFlightRef.current = false;
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const saveAsWork = async () => {
    if (!interview?.draft || busy || actionInFlightRef.current) return;
    const draft = draftWithApprovalPolicy(interview.draft);
    const prior = interview;
    const epoch = sessionEpochRef.current;
    actionInFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const workflowId = await persistDraftWork(draft, prior, epoch);
      if (!workflowId || !isCurrentSession(epoch)) return;
      const nextState: InterviewState = {
        ...prior,
        workflowId,
        title: interviewSessionTitle({ ...prior, workflowId }),
      };
      await window.ax.saveChatSession(nextState, nextState.summary, workflowId);
      if (!isCurrentSession(epoch)) return;
      setInterview(nextState);
      setSaved(true);
      if (nextState.workflow) {
        const snapshot = cloneInterviewDraft(nextState.workflow as InterviewDraft);
        setWorkflowBaseline(snapshot);
        setTurnDiffBaseline(snapshot);
      }
      await refresh();
      if (!isCurrentSession(epoch)) return;

    } catch (err) {
      if (!isCurrentSession(epoch)) return;
      setError(interviewErrorMessage(err));
    } finally {
      actionInFlightRef.current = false;
      if (isCurrentSession(epoch)) setBusy(false);
    }
  };

  const beginEditStep = (prompt: string) => {
    setEditHint(prompt);
  };

  return {
    interview,
    displayMessages,
    workflow: interview?.workflow as InterviewDraft | undefined,
    workflowBaseline,
    turnDiffBaseline,
    workflowDiffBaseline: (interview?.workflowId ? workflowBaseline : turnDiffBaseline) as
      | InterviewDraft
      | undefined,
    completeness: interview?.completeness as CompletenessResult | undefined,
    editHint,
    setEditHint,
    beginEditStep,
    saved,
    busy,
    error,
    progress,
    reset,
    startNewChat,
    loadWorkspaceChat,
    workspaceSessionId,
    openWorkChat,
    openInterviewChat,
    sendMessage,
    runOnce,
    saveAsWork,
    isLinkedWork: Boolean(interview?.workflowId),
    isImmediateOnce: interview?.draft ? isImmediateOnce(interview.draft) : false,
    isDeferredOnce: interview?.draft ? isDeferredOnce(interview.draft) : false,
    isRecurringDraft: interview?.draft ? isRecurringDraft(interview.draft) : false,
    workScope: interview?.workScope as WorkScope | undefined,
    allowExternalAuto,
    setAllowExternalAuto,
    approvalGateCount: approvalGates?.externalCount ?? 0,
    highRiskGateCount: approvalGates?.highRiskCount ?? 0,
  };
}

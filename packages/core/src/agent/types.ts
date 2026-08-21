import type { ZodType } from 'zod';
import type { ChatMessage } from './model/chat.js';

export type AgentRole = 'interview' | 'investigate' | 'revise';

export interface AgentExecutionPolicy {
  maxTurns: number;
  timeoutMs: number;
  cloudAllowed?: boolean;
}

export interface AgentRoleDefinition {
  role: AgentRole;
  /** Agent harness SKILL.md id (interview, investigate, revise). Not a saved workflow. */
  agentSkillId: string;
  temperature: number;
  policy: AgentExecutionPolicy;
  modeInstructions?: string;
}

export interface InterviewAgentContext {
  workflow: import('../interview/draft/schema.js').InterviewDraft;
  partialPlan?: import('../interview/plan/schema.js').WorkflowPlan;
  slotValues: Record<string, unknown>;
  completeness: import('../interview/slots/requiredness.js').CompletenessResult;
  connectedConnectors: string[];
  connectedResources: string;
  sessionHints: string;
  nowIso: string;
}

export interface InvestigateAgentContext {
  skillGoal: string;
  taskGoal: string;
  taskMemo?: string;
  evidence: Array<{ source: string; detail: string }>;
  untrustedData?: string;
  connectedConnectors: string[];
}

export interface ReviseAgentContext {
  workflowJson: string;
  instruction: string;
}

export type AgentContext =
  | InterviewAgentContext
  | InvestigateAgentContext
  | ReviseAgentContext;

export interface AgentProgressEvent {
  message: string;
}

export interface AgentRun<T> {
  role: AgentRole;
  outputSchema: ZodType<T>;
  context: AgentContext;
  messages?: ChatMessage[];
  user?: string;
  temperature?: number;
  sessionId?: string;
  cloudAllowed?: boolean;
  onProgress?: (event: AgentProgressEvent) => void;
  logContext?: string;
  codexReasoningEffort?: 'low' | 'medium' | 'high';
}

export interface AgentRunLog {
  level: 'info' | 'error';
  message: string;
}

export interface AgentResult<T> {
  output: T;
  role: AgentRole;
  provider: string;
  durationMs: number;
  promptChars: number;
  policy: AgentExecutionPolicy;
  logs: AgentRunLog[];
}

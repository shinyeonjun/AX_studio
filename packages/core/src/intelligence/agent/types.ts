import type { ZodType } from 'zod';
import type { ChatMessage } from './model/chat.js';
import type { ModelImageInput } from './model/provider.js';

export interface AgentProgressEvent {
  message: string;
}

export type AgentRole = 'command' | 'investigate';

export interface AgentExecutionPolicy {
  maxTurns: number;
  timeoutMs: number;
  cloudAllowed?: boolean;
}

export interface AgentRoleDefinition {
  role: AgentRole;
  /** Agent harness SKILL.md id. Not a saved workflow. */
  agentSkillId: string;
  temperature: number;
  policy: AgentExecutionPolicy;
}

export interface InvestigateAgentContext {
  skillGoal: string;
  taskGoal: string;
  taskMemo?: string;
  evidence: Array<{ source: string; detail: string }>;
  untrustedData?: string;
  connectedConnectors: string[];
}

export interface CommandAgentContext {
  connectedConnectors: string[];
  connectedResources: string;
  nowIso: string;
}

export type AgentContext =
  | InvestigateAgentContext
  | CommandAgentContext;

export interface AgentRun<T> {
  role: AgentRole;
  outputSchema: ZodType<T>;
  context: AgentContext;
  messages?: ChatMessage[];
  user?: string;
  images?: ModelImageInput[];
  temperature?: number;
  sessionId?: string;
  cloudAllowed?: boolean;
  onProgress?: (event: AgentProgressEvent) => void;
  logContext?: string;
  codexReasoningEffort?: 'low' | 'medium' | 'high';
  abortSignal?: AbortSignal;
  /**
   * Optional protocol-specific system prompt. The constitution remains
   * mandatory, while callers can replace the role skill when a bounded
   * machine-facing protocol is more appropriate than a human-facing skill.
   */
  systemPrompt?: string;
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

const ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  investigate: {
    role: 'investigate',
    agentSkillId: 'investigate',
    temperature: 0.2,
    policy: { maxTurns: 1, timeoutMs: 180_000 },
  },
  command: {
    role: 'command',
    agentSkillId: 'command',
    temperature: 0.2,
    policy: { maxTurns: 8, timeoutMs: 120_000 },
  },
};

export function getRoleDefinition(role: AgentRole): AgentRoleDefinition {
  return ROLE_DEFINITIONS[role];
}

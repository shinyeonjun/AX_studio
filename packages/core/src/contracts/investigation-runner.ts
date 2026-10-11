import type { ZodType } from 'zod';

/**
 * The protocol Runtime uses to ask a model for an AI decision. It lives in contracts so that
 * Runtime depends on this shape, not on the intelligence module that implements it.
 */

export interface ModelImageInput {
  data: Uint8Array;
  mimeType: string;
  pageIndex?: number;
  filename?: string;
}

export interface AgentProgressEvent {
  message: string;
}

export interface InvestigateAgentContext {
  skillGoal: string;
  taskGoal: string;
  taskMemo?: string;
  evidence: Array<{ source: string; detail: string }>;
  untrustedData?: string;
  connectedConnectors: string[];
}

/** The only model-facing surface required by Runtime AI decision steps. */
export interface InvestigationRunRequest<T> {
  outputSchema: ZodType<T>;
  context: InvestigateAgentContext;
  user?: string;
  images?: ModelImageInput[];
  cloudAllowed?: boolean;
  onProgress?: (event: AgentProgressEvent) => void;
  logContext?: string;
  abortSignal?: AbortSignal;
  codexReasoningEffort?: 'low' | 'medium' | 'high';
}

export interface InvestigationRunResult<T> {
  output: T;
}

/** Runtime depends on this protocol, not on the full AgentHarness. */
export interface InvestigationRunner {
  readonly providerName: string;
  /**
   * True when the request leaves this machine. Runtime treats an unknown answer as cloud,
   * so data is only sent out when the runner says it is local.
   */
  readonly isCloud?: boolean;
  run<T>(request: InvestigationRunRequest<T>): Promise<InvestigationRunResult<T>>;
}

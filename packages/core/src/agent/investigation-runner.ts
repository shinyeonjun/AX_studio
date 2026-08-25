import type { ZodType } from 'zod';
import type { InvestigateAgentContext } from './types.js';
import type { AgentProgressEvent } from './types.js';
import type { ModelImageInput } from './model/provider.js';

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
}

export interface InvestigationRunResult<T> {
  output: T;
}

/** Runtime depends on this protocol, not on the full AgentHarness. */
export interface InvestigationRunner {
  readonly providerName: string;
  run<T>(request: InvestigationRunRequest<T>): Promise<InvestigationRunResult<T>>;
}

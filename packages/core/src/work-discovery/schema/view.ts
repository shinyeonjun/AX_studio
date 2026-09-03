import { z } from 'zod';
import { ClarificationQuestionSchema } from '../clarification/types.js';
import type { DiscoveryRecoveryCheckpoint, DiscoveryStatus } from './status.js';

export interface DiscoveryFieldReview {
  outputPath: string;
  label?: string;
  display?: string;
  sourceId?: string;
  mappingLabel?: string;
  confidence?: number;
  replayByExample: Array<{
    exampleId: string;
    expectedDisplay: string;
    actualDisplay: string;
    pass: boolean;
    match: number;
  }>;
}

export interface DiscoveryInspectView {
  sessionId: string;
  status: DiscoveryStatus;
  revision: number;
  recoveryCheckpoint?: DiscoveryRecoveryCheckpoint;
  autoRecoveryAttempts?: number;
  progress: string;
  publishable: boolean;
  pendingQuestion?: z.infer<typeof ClarificationQuestionSchema>;
  observations: Array<{ path: string; label?: string; display: string }>;
  fieldReviews: DiscoveryFieldReview[];
  replaySummary: { total: number; passed: number; failed: number };
  workflowId?: string;
  errorCode?: string;
  errorMessage?: string;
  supportedOutputFormats: string[];
}

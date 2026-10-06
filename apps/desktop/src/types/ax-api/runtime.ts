import type {
  ExecutionResult,
  ToolResultConfirmation,
  EditableToolResult, ToolDraftUpdate, ToolReviewRequest, ToolResultReview, ToolSendOutcome,
} from '@ax-studio/core';
import type {
  GeneratedArtifactExportResult,
  GeneratedArtifactFolderSaveResult,
} from './contracts.js';
import type { ExecutionOutput } from '@ax-studio/core';

export interface AxRuntimeApi {
  getState: () => Promise<unknown>;
  approve: (id: string) => Promise<unknown>;
  confirmToolResult: (confirmation: ToolResultConfirmation) => Promise<ExecutionResult>;
  getToolResult: (lookup: string | { executionId: string }) => Promise<{ source?: EditableToolResult; outcome?: ToolSendOutcome; executionId?: string; refreshWarning?: boolean; persistenceWarning?: boolean; requiresReview: boolean; cancelled: boolean; processing: boolean }>;
  updateToolDraft: (input: ToolDraftUpdate) => Promise<EditableToolResult>;
  reviewToolResult: (input: ToolReviewRequest) => Promise<ToolResultReview>;
  reject: (id: string) => Promise<unknown>;
  deleteWorkflow: (workflowId: string) => Promise<unknown>;
  deleteExecution: (executionId: string) => Promise<unknown>;
  getExecutionOutput: (executionId: string) => Promise<ExecutionOutput>;
  clearExecutions: () => Promise<{ ok: boolean; removed: number }>;
  exportGeneratedArtifact: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  saveGeneratedArtifactToFolder: (artifactId: string) => Promise<GeneratedArtifactFolderSaveResult>;
  setWorkflowActive: (workflowId: string, active: boolean) => Promise<unknown>;
  loadWorkChat: (workflowId: string) => Promise<{ state: unknown; summary?: string; title?: string; active?: boolean }>;
  onStateChanged: (listener: () => void) => () => void;
  exportDiagnostics: () => Promise<
    | { ok: true; path: string }
    | { ok: false; canceled: true }
    | { ok: false; error: string }
  >;
  openLogFolder: () => Promise<{ ok: true } | { ok: false; error: string }>;
  importArtifact: () => Promise<
    | { ok: true; artifact: { id: string; fileName: string; storedPath: string; sha256: string; size: number; createdAt: string } }
    | { ok: false; canceled: true }
    | { ok: false; error: string }
  >;
}

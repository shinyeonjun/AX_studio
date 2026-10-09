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
  deleteWorkflow: (workflowId: string, options?: { deleteHistory?: boolean }) => Promise<unknown>;
  deleteExecution: (executionId: string) => Promise<unknown>;
  getExecutionOutput: (executionId: string) => Promise<ExecutionOutput>;
  clearExecutions: () => Promise<{ ok: boolean; removed: number }>;
  exportGeneratedArtifact: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  saveGeneratedArtifactToFolder: (artifactId: string) => Promise<GeneratedArtifactFolderSaveResult>;
  setWorkflowActive: (workflowId: string, active: boolean) => Promise<unknown>;
  runWorkflow: (workflowId: string) => Promise<{ executionId: string; status: string; errorCode?: string }>;
  loadWorkChat: {
    (workflowId: string): Promise<{ state: unknown; summary?: string; title?: string; active?: boolean }>;
    /** `optional`: null when the work no longer exists, instead of an error. */
    (workflowId: string, options: { optional: true }): Promise<{ state: unknown; summary?: string; title?: string; active?: boolean } | null>;
  };
  onStateChanged: (listener: () => void) => () => void;
  exportDiagnostics: () => Promise<
    | { ok: true; path: string }
    | { ok: false; canceled: true }
    | { ok: false; error: string }
  >;
  openLogFolder: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** A newer version: being downloaded, or downloaded and waiting for a restart. */
  getUpdateStatus?: () => Promise<UpdateStatus>;
  /** Restart into the downloaded version; false when none is ready. */
  installUpdate?: () => Promise<boolean>;
  onUpdateStatus?: (listener: (status: UpdateStatus) => void) => () => void;
  /** Starting the app (in the tray) when the person signs in, so recurring work runs after a restart. */
  getStartAtLogin?: () => Promise<StartAtLogin>;
  setStartAtLogin?: (enabled: boolean) => Promise<StartAtLogin>;
  importArtifact: () => Promise<
    | {
      ok: true;
      artifact: { id: string; fileName: string; storedPath: string; sha256: string; size: number; createdAt: string };
      /** Every chosen file, in order; `artifact` is the first. */
      artifacts?: Array<{ id: string; fileName: string; storedPath: string; sha256: string; size: number; createdAt: string }>;
    }
    | { ok: false; canceled: true }
    | { ok: false; error: string }
  >;
}

export type UpdateStatus =
  | { state: 'idle'; currentVersion: string }
  | { state: 'downloading'; currentVersion: string; version: string; percent: number }
  | { state: 'ready'; currentVersion: string; version: string };

export type StartAtLogin = { supported: false } | { supported: true; enabled: boolean };

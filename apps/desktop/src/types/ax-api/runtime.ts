import type { GeneratedArtifactExportResult } from './contracts.js';

export interface AxRuntimeApi {
  getState: () => Promise<unknown>;
  approve: (id: string) => Promise<unknown>;
  reject: (id: string) => Promise<unknown>;
  deleteWorkflow: (workflowId: string) => Promise<unknown>;
  deleteExecution: (executionId: string) => Promise<unknown>;
  clearExecutions: () => Promise<{ ok: boolean; removed: number }>;
  exportGeneratedArtifact: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  setGlobalActive: (active: boolean) => Promise<unknown>;
  setWorkflowActive: (workflowId: string, active: boolean) => Promise<unknown>;
  loadWorkChat: (workflowId: string) => Promise<{ state: unknown; summary?: string; title?: string; active?: boolean }>;
  printPdf: (html: string) => Promise<unknown>;
  onStateChanged: (listener: () => void) => () => void;
  importArtifact: () => Promise<
    | { ok: true; artifact: { id: string; fileName: string; storedPath: string; sha256: string; size: number; createdAt: string } }
    | { ok: false; canceled: true }
    | { ok: false; error: string }
  >;
}

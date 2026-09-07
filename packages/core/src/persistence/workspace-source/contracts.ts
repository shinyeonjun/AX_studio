import type * as sourceRepo from '../repositories/workspace-source-repository.js';

export type WorkspaceSourceStatus = sourceRepo.WorkspaceSourceStatus;
export type WorkspaceSourceSummary = sourceRepo.WorkspaceSourceSummary;
export type WorkspaceSourceRecord = sourceRepo.WorkspaceSourceRecord;

export interface WorkspaceSourceDocument {
  id: string;
  engine?: string;
  text?: string;
  pages: Array<{
    index: number;
    text?: string;
    hasVisual?: boolean;
    sourceType?: string;
    ocrApplied?: boolean;
    ocrConfidence?: number | null;
  }>;
  images: Array<{ id: string; pageIndex: number; ocrText?: string; ocrConfidence?: number | null }>;
  tables: Array<{ id: string; pageIndex: number; text?: string }>;
}

export interface WorkspaceSourceReadResult {
  source: WorkspaceSourceRecord;
  document: WorkspaceSourceDocument;
}

export class WorkspaceSourceError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = 'WorkspaceSourceError';
  }
}

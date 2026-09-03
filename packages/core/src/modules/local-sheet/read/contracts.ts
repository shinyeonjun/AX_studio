import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import type { WorkbookArtifact } from '../../../contracts/artifacts/workbook.js';

export interface ReadSheetOptions {
  path: string;
  sheetName?: string;
  rowLimit?: number;
}

export interface ReadWorkbookResult {
  workbook: WorkbookArtifact;
  tables: Record<string, TableArtifact>;
}

export interface MaterializeWorkbookOptions {
  path: string;
  rowLimit: number;
  workbookId: string;
  file: FileRef;
}

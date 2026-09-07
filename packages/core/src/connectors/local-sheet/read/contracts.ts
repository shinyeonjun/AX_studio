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

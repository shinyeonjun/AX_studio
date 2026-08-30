import { extname } from 'node:path';
import type { ArtifactStore } from '../../store/artifact-store.js';
import type { WorkbookMaterializer } from '../../contracts/discovery-source.js';
import type { OutputObservation } from './schema.js';
import { observeDocumentArtifact } from './observe-document.js';
import { observeTableArtifact } from './observe-table.js';
import { observeWorkbookArtifact } from './observe-workbook.js';

export function observeArtifact(
  exampleId: string,
  artifactId: string,
  artifactStore: ArtifactStore,
  materializeWorkbook: WorkbookMaterializer['readWorkbookFromPath'],
): OutputObservation[] {
  const document = artifactStore.getDocumentArtifact(artifactId);
  if (document) return observeDocumentArtifact(exampleId, document);

  const tableJson = artifactStore.getTableArtifact(`${artifactId}.table`);
  if (tableJson) return observeTableArtifact(exampleId, tableJson);

  const workbook = artifactStore.getWorkbookArtifact(artifactId);
  if (workbook) {
    const tables: Record<string, import('../../contracts/artifacts/table.js').TableArtifact> = {};
    for (const sheet of workbook.sheets) {
      for (const tableRef of sheet.tables) {
        const table = artifactStore.getTableArtifact(tableRef.artifactId);
        if (table) tables[tableRef.artifactId] = table;
      }
    }
    return observeWorkbookArtifact(exampleId, workbook, tables);
  }

  const stored = artifactStore.get(artifactId);
  if (!stored) return [];
  const ext = extname(stored.fileName).toLowerCase();
  if (['.csv', '.xlsx', '.xls'].includes(ext)) {
    const { workbook, tables } = materializeWorkbook(stored.storedPath);
    return observeWorkbookArtifact(exampleId, workbook, tables);
  }

  return [];
}

export const SUPPORTED_OUTPUT_FORMATS = ['pdf', 'xlsx', 'xls', 'csv'] as const;

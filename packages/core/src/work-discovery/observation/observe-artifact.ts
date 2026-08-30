import { extname } from 'node:path';
import type { ArtifactStore } from '../../store/artifact-store.js';
import { DocumentArtifactSchema } from '../../contracts/artifacts/document.js';
import { TableArtifactSchema } from '../../contracts/artifacts/table.js';
import { WorkbookArtifactSchema } from '../../contracts/artifacts/workbook.js';
import type { WorkbookMaterializer } from '../../contracts/discovery-source.js';
import type { OutputObservation } from './schema.js';
import { observeDocumentArtifact } from './observe-document.js';
import { observeTableArtifact } from './observe-table.js';
import { observeWorkbookArtifact } from './observe-workbook.js';

const DOCUMENT_ARTIFACT_FIELDS = [
  'source',
  'artifactPath',
  'engine',
  'pageCount',
  'chunkCount',
  'tableCount',
  'imageCount',
  'text',
  'pages',
  'images',
  'tables',
] as const;

function looksLikeDocumentArtifact(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return DOCUMENT_ARTIFACT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(value, field));
}

export function observeArtifact(
  exampleId: string,
  artifactId: string,
  artifactStore: ArtifactStore,
  materializeWorkbook: WorkbookMaterializer['readWorkbookFromPath'],
): OutputObservation[] {
  const documentJson = artifactStore.getDocumentArtifact<unknown>(artifactId);
  if (documentJson && looksLikeDocumentArtifact(documentJson)) {
    const parsed = DocumentArtifactSchema.safeParse(documentJson);
    if (parsed.success) return observeDocumentArtifact(exampleId, parsed.data);
  }

  const tableJson = artifactStore.getJson<unknown>(`${artifactId}.table`);
  const tableParsed = TableArtifactSchema.safeParse(tableJson);
  if (tableParsed.success) return observeTableArtifact(exampleId, tableParsed.data);

  const json = artifactStore.getJson<unknown>(artifactId);
  if (json) {
    if (looksLikeDocumentArtifact(json)) {
      const document = DocumentArtifactSchema.safeParse(json);
      if (document.success) return observeDocumentArtifact(exampleId, document.data);
    }
    const workbook = WorkbookArtifactSchema.safeParse(json);
    if (workbook.success) {
      const tables: Record<string, import('../../contracts/artifacts/table.js').TableArtifact> = {};
      for (const sheet of workbook.data.sheets) {
        for (const tableRef of sheet.tables) {
          const table = artifactStore.getJson<unknown>(tableRef.artifactId);
          const parsed = TableArtifactSchema.safeParse(table);
          if (parsed.success) tables[tableRef.artifactId] = parsed.data;
        }
      }
      return observeWorkbookArtifact(exampleId, workbook.data, tables);
    }
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

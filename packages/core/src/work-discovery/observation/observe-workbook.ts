import type { WorkbookArtifact } from '../../contracts/artifacts/workbook.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from './schema.js';
import { observeTableArtifact } from './observe-table.js';

export function observeWorkbookArtifact(
  exampleId: string,
  workbook: WorkbookArtifact,
  tables: Record<string, TableArtifact>,
): OutputObservation[] {
  const observations: OutputObservation[] = [];
  const seen = new Set<string>();
  for (const sheet of workbook.sheets) {
    for (const tableRef of sheet.tables) {
      const table = tables[tableRef.artifactId];
      if (!table) continue;
      for (const observation of observeTableArtifact(exampleId, table)) {
        const key = `${observation.path}:${observation.value.kind === 'number' ? observation.value.value : ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        observations.push(observation);
      }
    }
  }
  return observations;
}

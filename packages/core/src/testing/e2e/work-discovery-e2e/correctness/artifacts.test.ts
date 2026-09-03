import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { observeWorkbookArtifact } from '../../../../work-discovery/observation/observe-workbook.js';
import { readWorkbookFromPath } from '../../../../modules/local-sheet/read.js';
import { writeSalesXlsx } from '../fixtures.js';

describe('work discovery correctness regressions', () => {
  it('observes XLSX workbook output artifacts', () => {
    const dir = join(tmpdir(), `ax-wd-xlsx-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'report.xlsx');
    writeSalesXlsx(path, [{ amount: 42, actual: 10, target: 20 }]);
    const { workbook, tables } = readWorkbookFromPath(path);
    const observations = observeWorkbookArtifact('ex_xlsx', workbook, tables);
    expect(observations.length).toBeGreaterThan(0);
  });
});

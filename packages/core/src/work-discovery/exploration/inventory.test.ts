import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { inventorySources } from './inventory.js';
import type { OutputObservation } from '../observation/schema.js';

describe('inventorySources', () => {
  it('recalls sqlite sales table for revenue observation within budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-'));
    const dbPath = join(dir, 'sales.db');
    const snapshotDir = join(dir, 'snapshots');

    const { createDatabaseAsync } = await import('../../store/db.js');
    const db = await createDatabaseAsync(dbPath);
    db.exec('CREATE TABLE sales (amount REAL, product TEXT)');
    db.exec("INSERT INTO sales(amount, product) VALUES (620000000, 'A'), (620000000, 'B')");
    db.close?.();

    const observations: OutputObservation[] = [{
      id: 'obs_1',
      exampleId: 'ex_1',
      path: 'field.총매출',
      label: '총매출',
      value: { kind: 'number', value: 1_240_000_000, display: '12.4억' },
      role: 'dynamic_value',
      required: true,
    }];

    const result = await inventorySources('ex_1', observations, {
      rdb: { filePath: dbPath, allowedTables: ['sales'], rowLimit: 100 },
      snapshotDir,
      budget: { sourceReadsUsed: 0, sourceReadsMax: 1 },
    });

    expect(result.sources.some((source) => source.id === 'rdb:sales')).toBe(true);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.table?.columns.some((column) => column.name === 'amount')).toBe(true);
  });

  it('stops with reason when budget is exceeded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-discovery-'));
    const dbPath = join(dir, 'sales.db');
    const snapshotDir = join(dir, 'snapshots');
    const { createDatabaseAsync } = await import('../../store/db.js');
    const db = await createDatabaseAsync(dbPath);
    db.exec('CREATE TABLE sales (amount REAL)');
    db.exec('CREATE TABLE inventory (stock REAL)');
    db.close?.();

    const result = await inventorySources('ex_1', [], {
      rdb: { filePath: dbPath, allowedTables: ['sales', 'inventory'] },
      snapshotDir,
      budget: { sourceReadsUsed: 0, sourceReadsMax: 1 },
    });

    expect(result.budget.sourceReadsUsed).toBeLessThanOrEqual(1);
    expect(result.stoppedReason).toBe('budget_exceeded');
  });
});

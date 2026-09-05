import { describe, expect, it } from 'vitest';
import type { PdfReportPairAnalysis } from '../../document-engine/types/pdf.js';
import type { ReportPlanResult } from '../plan/execute.js';
import {
  materializeReportLayout,
  verifyReportExampleReplay,
} from './materialize.js';
import type { ReportLayoutPlan } from './schema.js';

const pair: PdfReportPairAnalysis = {
  schemaVersion: 1,
  pairId: 'pair-1',
  templateHash: 'template-hash',
  exampleHash: 'example-hash',
  pageCount: 1,
  pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
  scalarSlots: [
    { id: 'month', pageIndex: 0, rect: { x: 100, y: 50, width: 45, height: 12 }, exampleText: '2026년 8월', fontSize: 10, font: 'Fixture', color: 0 },
    { id: 'revenue', pageIndex: 0, rect: { x: 100, y: 80, width: 60, height: 12 }, exampleText: '125,000원', fontSize: 10, font: 'Fixture', color: 0 },
  ],
  tableGroups: [{
    id: 'customers-group',
    columnCount: 2,
    rowCount: 2,
    rows: [
      { index: 0, pageIndex: 0, y: 120, cells: [
        { id: 'r1-name', pageIndex: 0, rect: { x: 60, y: 120, width: 40, height: 12 }, exampleText: 'Acme', fontSize: 9, font: 'Fixture', color: 0 },
        { id: 'r1-sales', pageIndex: 0, rect: { x: 200, y: 120, width: 60, height: 12 }, exampleText: '100,000원', fontSize: 9, font: 'Fixture', color: 0 },
      ] },
      { index: 1, pageIndex: 0, y: 140, cells: [
        { id: 'r2-name', pageIndex: 0, rect: { x: 60, y: 140, width: 40, height: 12 }, exampleText: 'Beta', fontSize: 9, font: 'Fixture', color: 0 },
        { id: 'r2-sales', pageIndex: 0, rect: { x: 200, y: 140, width: 60, height: 12 }, exampleText: '25,000원', fontSize: 9, font: 'Fixture', color: 0 },
      ] },
    ],
  }],
  templateImages: [],
  exampleImages: [],
};

const layout: ReportLayoutPlan = {
  schemaVersion: 1,
  outputFileName: 'monthly-report.pdf',
  scalarBindings: [
    { slotId: 'month', value: { kind: 'metadata', key: 'periodLabel' } },
    { slotId: 'revenue', value: { kind: 'scalar', id: 'revenue' } },
  ],
  tableBindings: [{
    groupId: 'customers-group',
    tableId: 'customers',
    columns: [
      { columnIndex: 0, columnId: 'name' },
      { columnIndex: 1, columnId: 'sales' },
    ],
  }],
};

const result: ReportPlanResult = {
  scalars: { revenue: { raw: 125000, display: '125,000원' } },
  tables: {
    customers: {
      columns: ['name', 'sales'],
      rows: [
        { raw: { name: 'Acme', sales: 100000 }, display: { name: 'Acme', sales: '100,000원' } },
        { raw: { name: 'Beta', sales: 25000 }, display: { name: 'Beta', sales: '25,000원' } },
      ],
    },
  },
  texts: {},
};

describe('report layout materialization', () => {
  it('binds computed values to discovered geometry and replays every example cell', () => {
    const rendered = materializeReportLayout(pair, layout, result, { periodLabel: '2026년 8월' });
    expect(rendered.values).toEqual({
      month: '2026년 8월',
      revenue: '125,000원',
      'r1-name': 'Acme',
      'r1-sales': '100,000원',
      'r2-name': 'Beta',
      'r2-sales': '25,000원',
    });
    expect(rendered.template.sourceHash).toBe('template-hash');
    expect(rendered.template.fields.find((field) => field.id === 'r1-name')).toMatchObject({
      fontSize: 9,
      rect: { x: 60, width: 138 },
    });
    expect(verifyReportExampleReplay(pair, rendered.values)).toEqual({ ok: true, mismatches: [] });
  });

  it('fails replay when a computed value does not recreate the completed example', () => {
    const rendered = materializeReportLayout(pair, layout, {
      ...result,
      scalars: { revenue: { raw: 124999, display: '124,999원' } },
    }, { periodLabel: '2026년 8월' });
    expect(verifyReportExampleReplay(pair, rendered.values)).toEqual({
      ok: false,
      mismatches: [{ slotId: 'revenue', expected: '125,000원', actual: '124,999원' }],
    });
  });

  it('rejects a target table that exceeds the physical template capacity', () => {
    const overflow = structuredClone(result);
    overflow.tables.customers!.rows.push({
      raw: { name: 'Gamma', sales: 1 }, display: { name: 'Gamma', sales: '1원' },
    });
    expect(() => materializeReportLayout(pair, layout, overflow, { periodLabel: '2026년 9월' }))
      .toThrow('report_table_capacity_exceeded:customers-group');
  });
});

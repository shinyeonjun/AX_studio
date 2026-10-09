import { z } from 'zod';
import type { ConnectorResult } from '../../../connectors/types.js';
import type { ReportSourceSnapshot } from '../plan/schema.js';

export interface ReportPeriod {
  start: string;
  endInclusive: string;
  label: string;
}

export interface ReportHttpSourceSpec {
  alias: string;
  connectionId?: string;
  path: string;
  rowsPath: string;
  staticQuery?: Record<string, string | number | boolean>;
  dateQuery?: {
    fromParam: string;
    toParam: string;
  };
  pagination?: {
    pageParam: string;
    sizeParam: string;
    pageSize: number;
    totalPagesPath: string;
    maxPages: number;
    startPage?: 0 | 1;
    currentPagePath?: string;
  };
}

interface ReportRdbSourceSpec {
  alias: string;
  table: string;
}

/** A CSV/xlsx sheet in a connected folder. */
export interface ReportFileSourceSpec {
  alias: string;
  folderId: string;
  /** The example period's file, relative to the folder. */
  path: string;
  sheet?: string;
  /**
   * One file per period, named for it (매출_2026-08.xlsx, 매출_2026-09.xlsx): another period reads
   * the file named for that period. Otherwise every period reads this one file and filters rows.
   */
  perPeriod?: boolean;
}

export interface ReportSourceCapturePlan {
  schemaVersion: 1;
  http: ReportHttpSourceSpec[];
  rdb: ReportRdbSourceSpec[];
  /** Absent in plans made before files could be sources. */
  file?: ReportFileSourceSpec[];
}

export interface ReportSourceGateway {
  executeHttp(params: Record<string, unknown>): Promise<ConnectorResult>;
  executeRdb(params: Record<string, unknown>): Promise<ConnectorResult>;
  /** Reads one sheet of a connected folder's file; required only when the plan has file sources. */
  executeFile?(params: { folderId: string; path: string; sheet?: string }): Promise<ConnectorResult>;
}

export type CapturedReportSources = Record<string, ReportSourceSnapshot>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'report_date_invalid');
const IdentifierSchema = z.string().trim().min(1).max(160);
const REPORT_PROBE_ORIGIN = 'http://report-probe.invalid';
export const MAX_REPORT_HTTP_PAGES = 1_000;

/**
 * Report plans may address only a relative path on the selected connection.
 * Keep this check shared by model decisions, capture plans, and probes so a
 * later boundary cannot accidentally accept an absolute or off-origin URL.
 */
export function normalizeReportHttpPath(value: string): string {
  const raw = value.trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) {
    throw new Error('report_http_path_invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw, REPORT_PROBE_ORIGIN);
  } catch {
    throw new Error('report_http_path_invalid');
  }
  if (parsed.origin !== REPORT_PROBE_ORIGIN) throw new Error('report_http_path_invalid');
  return `${parsed.pathname}${parsed.search}`;
}

export const ReportHttpPathSchema = z.string().trim().min(1).max(2_048).refine((value) => {
  try {
    normalizeReportHttpPath(value);
    return true;
  } catch {
    return false;
  }
}, 'report_http_path_invalid');

export const ReportPeriodSchema: z.ZodType<ReportPeriod> = z.object({
  start: IsoDateSchema,
  endInclusive: IsoDateSchema,
  label: z.string().trim().min(1).max(160),
}).superRefine((value, context) => {
  if (value.start > value.endInclusive) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'report_period_invalid' });
  }
});

const ReportHttpSourceSchema: z.ZodType<ReportHttpSourceSpec> = z.object({
  alias: IdentifierSchema,
  connectionId: IdentifierSchema.optional(),
  path: ReportHttpPathSchema,
  rowsPath: IdentifierSchema,
  staticQuery: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  dateQuery: z.object({
    fromParam: IdentifierSchema,
    toParam: IdentifierSchema,
  }).optional(),
  pagination: z.object({
    pageParam: IdentifierSchema,
    sizeParam: IdentifierSchema,
    pageSize: z.number().int().min(1).max(10_000),
    totalPagesPath: IdentifierSchema,
    maxPages: z.number().int().min(1).max(MAX_REPORT_HTTP_PAGES),
    startPage: z.union([z.literal(0), z.literal(1)]).optional(),
    currentPagePath: IdentifierSchema.optional(),
  }).optional(),
}).superRefine((source, context) => {
  const controls = [
    ...(source.dateQuery ? [source.dateQuery.fromParam, source.dateQuery.toParam] : []),
    ...(source.pagination ? [source.pagination.pageParam, source.pagination.sizeParam] : []),
  ];
  if (new Set(controls).size !== controls.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'report_http_query_params_conflict' });
  }
});

const ReportRdbSourceSchema: z.ZodType<ReportRdbSourceSpec> = z.object({
  alias: IdentifierSchema,
  table: IdentifierSchema,
});

/** A path inside a connected folder: relative, no climbing out, no drive or UNC prefix. */
export const ReportFilePathSchema = z.string().trim().min(1).max(1_024).refine((value) => {
  const parts = value.split(/[\\/]+/u);
  return !/^(?:[a-z]:|[\\/])/iu.test(value) && !parts.includes('..') && /\.(?:csv|xlsx|xls)$/iu.test(value);
}, 'report_file_path_invalid');

const ReportFileSourceSchema: z.ZodType<ReportFileSourceSpec> = z.object({
  alias: IdentifierSchema,
  folderId: IdentifierSchema,
  path: ReportFilePathSchema,
  sheet: z.string().trim().min(1).max(160).optional(),
  perPeriod: z.boolean().optional(),
});

export const ReportSourceCapturePlanSchema: z.ZodType<ReportSourceCapturePlan> = z.object({
  schemaVersion: z.literal(1),
  http: z.array(ReportHttpSourceSchema).max(20),
  rdb: z.array(ReportRdbSourceSchema).max(20),
  file: z.array(ReportFileSourceSchema).max(20).optional(),
});

/** Every file source of a plan; older plans have none. */
export function reportFileSources(plan: Pick<ReportSourceCapturePlan, 'file'>): ReportFileSourceSpec[] {
  return plan.file ?? [];
}

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

export interface ReportRdbSourceSpec {
  alias: string;
  table: string;
}

export interface ReportSourceCapturePlan {
  schemaVersion: 1;
  http: ReportHttpSourceSpec[];
  rdb: ReportRdbSourceSpec[];
}

export interface ReportSourceGateway {
  executeHttp(params: Record<string, unknown>): Promise<ConnectorResult>;
  executeRdb(params: Record<string, unknown>): Promise<ConnectorResult>;
}

export type CapturedReportSources = Record<string, ReportSourceSnapshot>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'report_date_invalid');
const IdentifierSchema = z.string().trim().min(1).max(160);
const REPORT_PROBE_ORIGIN = 'http://report-probe.invalid';

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
    maxPages: z.number().int().min(1).max(1_000),
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

export const ReportSourceCapturePlanSchema: z.ZodType<ReportSourceCapturePlan> = z.object({
  schemaVersion: z.literal(1),
  http: z.array(ReportHttpSourceSchema).max(20),
  rdb: z.array(ReportRdbSourceSchema).max(20),
});

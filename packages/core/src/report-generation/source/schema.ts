import { z } from 'zod';
import type { ConnectorResult } from '../../modules/types.js';
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
  path: z.string().trim().min(1).max(2_048),
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
  }).optional(),
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

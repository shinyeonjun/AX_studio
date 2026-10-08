import type { DecisionInstruction } from '../../../../../../contracts/decision.js';
import type { TableArtifact } from '../../../../../../contracts/artifacts/table.js';
import type { TransformExpr } from '../../../../../../workflow/transform-expr/dsl.js';

export const JEV_TABLE_TRANSFORM_CRITERIA = {
  export_xlsx: 'Export exactly the current displayed table to an Excel xlsx file, preserving all its current rows, columns and order. No new query, extra transform, arbitrary format or external send.',
  unsupported: 'The user asks for an operation beyond filtering, sorting, selecting columns or summarizing, such as sending a file, other export formats, or joining other data. Do not return an unchanged table as fulfillment.',
  calculate: 'Compute a count, sum, average, minimum or maximum, overall or per group (지역별, 상태별), optionally over rows matching conditions such as a month or a status (e.g. 9월 완료 주문의 매출 합계, 지역별 주문 건수).',
  none: 'Return the retrieved data without filtering or sorting.',
  filter: 'Keep only rows matching one clearly specified comparison threshold condition (e.g. price > 1000, status is active). Do not choose filter for Top-N row count limits.',
  sort: 'Reorder rows by one clearly specified column and direction, optionally keeping the top N rows (e.g., lowest 3, highest 5).',
  filter_sort: 'Apply one clearly specified comparison condition (e.g. price > 1000), then sort by one clearly specified column and direction.',
} satisfies Record<string, DecisionInstruction>;
export type JevTableTransformMode = Exclude<keyof typeof JEV_TABLE_TRANSFORM_CRITERIA, 'none'>;
export type JevTableTransformRequest = JevTableTransformMode | 'none' | 'uncertain' | 'auto';
export const JEV_TABLE_PROJECTION_CRITERIA = {
  all_columns: 'Show the complete result schema; no explicit subset was requested.',
  requested_columns: 'Show only the result fields explicitly named or clearly requested by the user.',
} satisfies Record<string, DecisionInstruction>;
export type JevTableProjectionRequest = 'requested_columns';

export type JevTableTransformResult =
  | { status: 'export_xlsx'; model?: string; providerRequestCount?: number; usage?: { inputTokens?: number; outputTokens?: number } }
  | { status: 'transformed'; table: TableArtifact; expression: TransformExpr; model?: string; providerRequestCount?: number; usage?: { inputTokens?: number; outputTokens?: number } }
  | { status: 'clarify'; message: string; model?: string; providerRequestCount?: number; usage?: { inputTokens?: number; outputTokens?: number } }
  | { status: 'not_applicable'; model?: string; providerRequestCount?: number; usage?: { inputTokens?: number; outputTokens?: number } }
  | { status: 'unavailable'; providerRequestCount?: number };

/**
 * Seeded synthetic "monthly report" worlds for testing Discovery against many shapes of data,
 * not one demo file. Each world has a TRUE rule (group column, optional excluded status, measure
 * functions, rounding, optional total row) that produces report tables from orders. The true
 * report is computed here independently of the TransformExpr evaluator.
 */
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(this.next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
    }
    return copy;
  }
  /** `count` distinct items, in random order. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, count);
  }
}

const KEY_COLUMNS = ['카테고리', 'category', '지역', 'Region', '부서', 'product_line', '채널', '品目'];
const REPORT_KEY_HEADERS = ['구분', 'Category', '항목', 'segment', '분류'];
const AMOUNT_COLUMNS = ['금액', 'amount', '매출액', 'Sales', 'revenue_krw'];
const QUANTITY_COLUMNS = ['수량', 'qty', 'units', '판매수량'];
const STATUS_COLUMNS = ['상태', 'status', '처리상태', 'order_state'];
const NOISE_COLUMNS = ['담당자', 'owner', '결제수단', 'payment'];
const STATUS_SETS = [['완료', '배송중', '취소'], ['done', 'pending', 'void', 'returned'], ['정상', '반품'], ['paid', 'refunded', 'hold']];
const NOISE_VALUES = ['김', '이', '박', '최', 'card', 'cash', 'transfer', 'Kim', 'Lee'];
const CATEGORY_NAMES = [
  '생활용품', '식품', '전자기기', '문구', '의류', '가구', '도서', '완구', 'Beauty', 'Sports', 'Garden', 'Pet', 'Auto', 'Music',
  '서울', '부산', 'East', 'West', 'Online', 'Retail',
];
const TOTAL_LABELS = ['합계', 'Total', '총계', '전체', 'ALL', 'Σ', 'Grand total'];
const MEASURE_HEADERS = ['건수', 'orders', '매출', 'Revenue', '평균금액', 'avg_ticket', '판매량', 'max_sale', '최소수량', '총액'];

export type AggregateFnName = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface TrueMeasure {
  header: string;
  fn: AggregateFnName;
  column?: string;
  round?: number;
}

export interface SyntheticWorld {
  seed: number;
  groupColumn: string;
  reportKeyHeader: string;
  amountColumn: string;
  amountDecimals: number;
  quantityColumn: string;
  statusColumn: string;
  statusValues: string[];
  /** Rows with this status are left out of the report (undefined: nothing is left out). */
  excludedStatus?: string;
  noiseColumn: string;
  sourceColumnOrder: string[];
  measures: TrueMeasure[];
  totalLabel?: string;
  sheetName: string;
  summarySheetName: string;
  /** Headers of the summary's kept-row count and amount total. */
  summaryHeaders: [string, string];
  unusedCategories: string[];
}

export interface SyntheticMonth {
  categories: string[];
  source: TableArtifact;
  /** The multi-row report table (one row per group, maybe a total row). */
  report: TableArtifact;
  /** One-row summary over the same kept rows: count and sum of the amount. */
  summary: TableArtifact;
}

type OrderRow = Record<string, string | number>;

/** Half-up rounding on the decimal representation (the report author's rounding). */
export function roundHalfUp(value: number, digits: number): number {
  return Number(`${Math.round(Number(`${value}e${digits}`))}e-${digits}`);
}

export function createWorld(seed: number): SyntheticWorld {
  const rng = new Rng(seed);
  const groupColumn = rng.pick(KEY_COLUMNS);
  const amountColumn = rng.pick(AMOUNT_COLUMNS);
  const quantityColumn = rng.pick(QUANTITY_COLUMNS);
  const statusColumn = rng.pick(STATUS_COLUMNS);
  const noiseColumn = rng.pick(NOISE_COLUMNS);
  const statusValues = rng.pick(STATUS_SETS);
  const excludedStatus = rng.bool(0.6) ? rng.pick(statusValues) : undefined;
  const amountDecimals = rng.pick([0, 0, 1, 2]);
  const headers = rng.sample(MEASURE_HEADERS, 3);
  const measurePool: TrueMeasure[] = [
    { header: '', fn: 'count' },
    { header: '', fn: 'sum', column: amountColumn },
    { header: '', fn: 'avg', column: amountColumn, round: rng.pick([0, 1, 2]) },
    { header: '', fn: 'sum', column: quantityColumn },
    { header: '', fn: 'max', column: amountColumn },
    { header: '', fn: 'min', column: quantityColumn },
  ];
  const measures = rng.sample(measurePool, rng.int(1, 3)).map((measure, index) => ({ ...measure, header: headers[index]! }));
  const categoryCount = rng.int(2, 7);
  const categories = rng.sample(CATEGORY_NAMES, categoryCount + 1);
  const sourceColumns = [groupColumn, amountColumn, quantityColumn, statusColumn, noiseColumn, '주문번호'];
  return {
    seed,
    groupColumn,
    reportKeyHeader: rng.bool(0.5) ? groupColumn : rng.pick(REPORT_KEY_HEADERS.filter((header) => header !== groupColumn)),
    amountColumn,
    amountDecimals,
    quantityColumn,
    statusColumn,
    statusValues,
    excludedStatus,
    noiseColumn,
    sourceColumnOrder: rng.shuffle(sourceColumns),
    measures,
    totalLabel: rng.bool(0.6) ? rng.pick(TOTAL_LABELS) : undefined,
    sheetName: rng.pick(['카테고리별', 'by_group', '구분별 실적', 'Pivot']),
    summarySheetName: rng.pick(['요약', 'Summary']),
    summaryHeaders: rng.pick([['총건수', '총액합계'], ['order_count', 'total_amount'], ['건수 합계', 'Net sales']] as Array<[string, string]>),
    // The first `categoryCount` names are month A's categories; the extra one is the newcomer.
    unusedCategories: categories,
  };
}

function orderRows(world: SyntheticWorld, rng: Rng, categories: string[], rowCount: number): OrderRow[] {
  const noise = rng.sample(NOISE_VALUES, rng.int(2, 4));
  const scale = 10 ** world.amountDecimals;
  return Array.from({ length: rowCount }, (_, index) => ({
    [world.groupColumn]: rng.pick(categories),
    [world.amountColumn]: rng.int(100, 99_999 * scale) / scale,
    [world.quantityColumn]: rng.int(1, 9),
    [world.statusColumn]: rng.pick(world.statusValues),
    [world.noiseColumn]: rng.pick(noise),
    주문번호: `ORD-${world.seed}-${index + 1}`,
  }));
}

function trueAggregate(rows: OrderRow[], measure: TrueMeasure): number | null {
  if (measure.fn === 'count') return rows.length;
  const values = rows.map((row) => Number(row[measure.column!]));
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  switch (measure.fn) {
    case 'sum':
      return sum;
    case 'avg':
      return measure.round === undefined ? sum / values.length : roundHalfUp(sum / values.length, measure.round);
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
  }
}

/** What a careful author writes: sums carry the source precision, not float noise. */
function authored(value: number | null, world: SyntheticWorld, measure: TrueMeasure): number | null {
  if (value == null || measure.fn !== 'sum' || measure.column !== world.amountColumn) return value;
  return roundHalfUp(value, world.amountDecimals);
}

export function buildMonth(world: SyntheticWorld, month: 'A' | 'B'): SyntheticMonth {
  const rng = new Rng(world.seed * 31 + (month === 'A' ? 1 : 2));
  const categoryCount = world.unusedCategories.length - 1;
  const monthA = world.unusedCategories.slice(0, categoryCount);
  // Month B: one category disappears and a new one appears.
  const dropped = rng.int(0, categoryCount - 1);
  const categories = month === 'A'
    ? monthA
    : [...monthA.filter((_, index) => index !== dropped), world.unusedCategories[categoryCount]!];
  const rows = orderRows(world, rng, categories, rng.int(30, 400));
  const source = buildTableArtifact({
    id: `orders-${world.seed}-${month}`,
    name: 'orders',
    headers: world.sourceColumnOrder,
    matrix: rows.map((row) => world.sourceColumnOrder.map((column) => row[column])),
  });
  const kept = rows.filter((row) => world.excludedStatus === undefined || row[world.statusColumn] !== world.excludedStatus);
  const groups = new Map<string, OrderRow[]>();
  for (const row of kept) {
    const key = String(row[world.groupColumn]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const reportRows = [...groups].map(([key, groupRows]) => [key, ...world.measures.map((measure) => authored(trueAggregate(groupRows, measure), world, measure))]);
  // Authors sort as they like; the total row usually closes the table but not always.
  const ordered = rng.shuffle(reportRows);
  if (world.totalLabel !== undefined) {
    const totalRow = [world.totalLabel, ...world.measures.map((measure) => authored(trueAggregate(kept, measure), world, measure))];
    ordered.splice(rng.bool(0.8) ? ordered.length : 0, 0, totalRow);
  }
  const reportHeaders = [world.reportKeyHeader, ...world.measures.map((measure) => measure.header)];
  const columnOrder = rng.shuffle(reportHeaders.map((_, index) => index));
  const report = buildTableArtifact({
    id: `report-${world.seed}-${month}`,
    name: world.sheetName,
    headers: columnOrder.map((index) => reportHeaders[index]!),
    matrix: ordered.map((row) => columnOrder.map((index) => row[index])),
  });
  const amountTotal = roundHalfUp(kept.reduce((total, row) => total + Number(row[world.amountColumn]), 0), world.amountDecimals);
  const summary = buildTableArtifact({
    id: `summary-${world.seed}-${month}`,
    name: world.summarySheetName,
    headers: ['기간', ...world.summaryHeaders],
    matrix: [[month === 'A' ? '2026-08' : '2026-09', kept.length, amountTotal]],
  });
  return { categories, source, report, summary };
}

export function describeWorld(world: SyntheticWorld): string {
  return JSON.stringify({
    seed: world.seed,
    group: world.groupColumn,
    keyAs: world.reportKeyHeader,
    excluded: world.excludedStatus ? `${world.statusColumn}≠${world.excludedStatus}` : null,
    measures: world.measures.map((measure) => `${measure.header}=${measure.fn}(${measure.column ?? ''})${measure.round ?? ''}`),
    total: world.totalLabel ?? null,
  });
}

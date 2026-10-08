import type { AgentHarness } from './harness.js';

/** Table name → a short Korean description people (and Jev) can match a request against. */
export type TableDescriptions = Record<string, string>;

export const MAX_TABLE_DESCRIPTION_CHARS = 60;
const MAX_TABLES_PER_ASK = 60;
const MAX_COLUMNS_SHOWN = 20;
const DESCRIBE_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = [
  '데이터베이스 표 이름과 열 이름을 보고, 업무 담당자가 알아볼 짧은 한국어 설명을 붙인다.',
  '- 입력: {"database":"DB 이름","tables":[{"name":"표 이름","columns":["열 이름"]}]}',
  '- 출력: {"표 이름":"한국어 설명"} JSON 객체 하나만. 설명, 코드 블록 금지.',
  '- 설명은 "무엇의 표인지 · 주요 내용" 형태로 40자 안팎. 예: tb_ord_mst → "주문 원장 · 주문별 고객·금액·상태", hr_leave_balances → "직원별 남은 연차".',
  '- 이름과 열만 보고 뜻을 정한다. 뜻을 알 수 없는 표는 출력에서 뺀다.',
].join('\n');

export interface TableShapeForDescription {
  table: string;
  columns: readonly string[];
}

function validDescription(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_TABLE_DESCRIPTION_CHARS && !/[\r\n]/u.test(value);
}

function parseDescriptions(output: string, asked: readonly string[]): TableDescriptions {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  return Object.fromEntries(asked.flatMap((name) => validDescription(record[name]) ? [[name, (record[name] as string).trim()]] : []));
}

/**
 * Short Korean descriptions for a database's tables, asked once of the person's AI from the
 * table and column names only (never a row). Tables already described are not asked again; a
 * failure returns what was known, so a connection never waits on or fails because of this.
 */
export async function describeTables(input: {
  harness: Pick<AgentHarness, 'runText'>;
  database: string;
  tables: readonly TableShapeForDescription[];
  known?: TableDescriptions;
  signal?: AbortSignal;
}): Promise<TableDescriptions> {
  const known = input.known ?? {};
  const missing = input.tables.filter((shape) => !known[shape.table]).slice(0, MAX_TABLES_PER_ASK);
  if (missing.length === 0) return known;
  try {
    const timeout = AbortSignal.timeout(DESCRIBE_TIMEOUT_MS);
    const reply = await input.harness.runText({
      role: 'command',
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify({
        database: input.database.slice(0, 80),
        tables: missing.map((shape) => ({ name: shape.table, columns: shape.columns.slice(0, MAX_COLUMNS_SHOWN) })),
      }) }],
      logContext: 'table_descriptions',
      abortSignal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
    });
    return { ...known, ...parseDescriptions(reply.output, missing.map((shape) => shape.table)) };
  } catch (error) {
    input.signal?.throwIfAborted();
    return known;
  }
}

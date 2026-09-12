import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const pythonPath = join(here, '..', '..', 'packages', 'document-engine', '.venv', 'Scripts', 'python.exe');

const PDF_SCRIPT = String.raw`
import json
import os
import sys
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

payload = json.load(sys.stdin)
font_path = payload.get("fontPath")
font_name = "Helvetica"
if font_path and os.path.isfile(font_path):
    font_name = "AxBenchmarkFont"
    pdfmetrics.registerFont(TTFont(font_name, font_path))

def draw_text(document, x, y, value, size=9):
    document.setFont(font_name, size)
    document.setFillColor(colors.HexColor("#203154"))
    document.drawString(x, y, str(value))

def draw_table(document, rows, values):
    x = 40.0
    top = 635.0 if payload.get("footer") == "tight" else 700.0
    width = 515.0
    row_height = 19.0
    columns = ("고객 ID", "고객", "지역", "매출", "주문", "달성률")
    widths = (62.0, 105.0, 66.0, 104.0, 55.0, 105.0)
    document.setFillColor(colors.HexColor("#DDE7F5"))
    document.rect(x, top - row_height, width, row_height, stroke=0, fill=1)
    offset = x
    for index, label in enumerate(columns):
        draw_text(document, offset + 5, top - 13, label, 8)
        offset += widths[index]
    for row_index in range(rows):
        y = top - row_height * (row_index + 2)
        document.setFillColor(colors.white if row_index % 2 == 0 else colors.HexColor("#F3F6FA"))
        document.rect(x, y, width, row_height, stroke=0, fill=1)
        if row_index >= len(values):
            continue
        values_for_row = values[row_index]
        offset = x
        for column_index, key in enumerate(("id", "name", "region", "revenue", "orders", "attainment")):
            draw_text(document, offset + 5, y + 5, values_for_row[key], 8)
            offset += widths[column_index]

def write_pdf(path, values):
    document = canvas.Canvas(str(path), pagesize=A4)
    draw_text(document, 40, 805, "월간 고객 매출 및 운영 리스크 보고서", 14)
    draw_text(document, 400, 805, "AX REPORT E2E", 8)
    draw_text(document, 40, 780, "보고 기간", 9)
    draw_text(document, 160, 780, values.get("period", "") if values else "", 9)
    draw_text(document, 40, 755, "총 매출", 9)
    draw_text(document, 160, 755, values.get("revenue", "") if values else "", 9)
    draw_text(document, 300, 755, "인정 주문", 9)
    draw_text(document, 400, 755, values.get("orders", "") if values else "", 9)
    draw_text(document, 40, 730, "고객 수", 9)
    draw_text(document, 160, 730, values.get("customers", "") if values else "", 9)
    draw_text(document, 300, 730, "목표 달성률", 9)
    draw_text(document, 400, 730, values.get("attainment", "") if values else "", 9)
    draw_table(document, payload["templateRows"], (values or {}).get("rows", []))
    footer_y = 535.0 if payload.get("footer") == "tight" else 465.0
    draw_text(document, 40, footer_y, "처리 상태", 8)
    draw_text(document, 160, footer_y, values.get("status", "") if values else "", 8)
    draw_text(document, 40, footer_y - 18, "원천 데이터: 주문 REST API + 고객 계약 DB", 8)
    draw_text(document, 40, footer_y - 36, "계산 기준과 원본 행을 확인한 후 사용하세요.", 8)
    draw_text(document, 40, footer_y - 54, "SOURCE: orders-api + customer-db", 7)
    document.showPage()
    document.save()

root = Path(payload["root"])
root.mkdir(parents=True, exist_ok=True)
write_pdf(root / "template.pdf", None)
write_pdf(root / "example.pdf", payload["example"])
`;

export function createPdfPair(root, benchmarkCase) {
  mkdirSync(root, { recursive: true });
  const fontCandidates = [
    'C:\\Windows\\Fonts\\malgun.ttf',
    'C:\\Windows\\Fonts\\malgunsl.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  ];
  const fontPath = fontCandidates.find((candidate) => existsSync(candidate)) ?? null;
  const values = Object.fromEntries([
    ['period', benchmarkCase.exampleExpected.scalars[0]],
    ['revenue', benchmarkCase.exampleExpected.scalars[1]],
    ['orders', benchmarkCase.exampleExpected.scalars[2]],
    ['customers', benchmarkCase.exampleExpected.scalars[3]],
    ['attainment', benchmarkCase.exampleExpected.scalars[4]],
    ['status', benchmarkCase.exampleExpected.scalars[5]],
    ['rows', benchmarkCase.exampleExpected.rows],
  ]);
  const payload = JSON.stringify({
    root,
    templateRows: benchmarkCase.templateRows,
    footer: benchmarkCase.footer,
    example: values,
    fontPath,
  });
  const result = spawnSync(pythonPath, ['-c', PDF_SCRIPT], { input: payload, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error('pdf_fixture_failed:' + (result.stderr || result.stdout || 'unknown'));
  }
  return { templatePath: join(root, 'template.pdf'), examplePath: join(root, 'example.pdf') };
}

export async function startOrdersServer(benchmarkCase) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams.entries()) });
    if (url.pathname !== '/api/v1/orders') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    const fault = benchmarkCase.httpFault;
    if (fault?.kind === 'status') {
      response.writeHead(fault.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'fixture_http_failure' }));
      return;
    }
    const period = url.searchParams.get('from') === benchmarkCase.targetPeriod.start
      ? benchmarkCase.targetOrders
      : benchmarkCase.exampleOrders;
    const pageSize = Number(url.searchParams.get('size') ?? '2') || 2;
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const totalPages = Math.max(1, Math.ceil(period.length / pageSize));
    const items = fault?.kind === 'repeat-page' && page === fault.page
      ? period.slice(0, pageSize)
      : period.slice((page - 1) * pageSize, page * pageSize);
    if (fault?.kind === 'invalid-json') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('fixture response is not json');
      return;
    }
    const responsePage = fault?.kind === 'page-mismatch' && page === fault.page
      ? page + 1
      : page;
    const payload = benchmarkCase.httpEnvelope === 'nested'
      ? { meta: { page: responsePage, totalPages }, data: { items } }
      : { page: responsePage, totalPages, items };
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture_http_address_missing');
  return {
    baseUrl: 'http://127.0.0.1:' + address.port,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

export function createRdbFixture(benchmarkCase, buildTableArtifact) {
  const calls = [];
  const fault = benchmarkCase.rdbFault;
  const sourceRows = fault?.kind === 'duplicate-customer' && fault.customer
    ? [...benchmarkCase.customers, fault.customer]
    : benchmarkCase.customers;
  return {
    name: 'rdb',
    calls,
    async execute(action, params) {
      calls.push({ action, params });
      if (action === 'schema.describe') return { ok: true, data: ['public.customers'] };
      if (action === 'table.describe') {
        return { ok: true, data: { table: 'public.customers', columns: [
          { name: 'customer_id', type: 'text' },
          { name: 'name', type: 'text' },
          { name: 'region', type: 'text' },
          { name: 'target', type: 'numeric' },
        ] } };
      }
      if (action !== 'query.read' || params.table !== 'public.customers') {
        return { ok: false, error: 'fixture_action_denied', errorCode: 'invalid_params' };
      }
      const offset = typeof params.offset === 'number' ? params.offset : 0;
      const pageSize = benchmarkCase.rdbPageSize ?? 2;
      const rows = fault?.kind === 'repeat-page' && offset > 0
        ? sourceRows.slice(0, pageSize)
        : sourceRows.slice(offset, offset + pageSize);
      const hasMore = offset + rows.length < sourceRows.length;
      const table = buildTableArtifact({
        id: 'fixture_customers_' + offset,
        name: 'public.customers',
        headers: ['customer_id', 'name', 'region', 'target'],
        matrix: rows.map(row => [row.customer_id, row.name, row.region, row.target]),
        rowLimit: pageSize,
        source: { database: 'fixture', schema: 'public', table: 'customers' },
      });
      const incomplete = fault?.kind === 'incomplete';
      table.truncated = incomplete || hasMore;
      table.completeness = incomplete
        ? { status: 'partial', reason: 'row_limit', observedCount: rows.length, limit: pageSize, hasMore: false }
        : hasMore
        ? { status: 'partial', reason: 'row_limit', observedCount: rows.length, limit: pageSize, hasMore: true }
        : { status: 'complete', observedCount: rows.length, hasMore: false };
      return { ok: true, data: { ...table, offset, ...(hasMore ? { nextOffset: offset + rows.length } : {}) } };
    },
  };
}

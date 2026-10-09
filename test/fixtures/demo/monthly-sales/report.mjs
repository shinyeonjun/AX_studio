// The month's finished report, as a person would have made it by hand: cancelled orders are left
// out, one summary row, and a per-category table (largest sales first) closed by a total row.
// Shared by the fixture generator and the PDF version of the same report.
const TOTAL_LABEL = '합계';
export function report(period, rows) {
  const kept = rows.filter((row) => row.상태 !== '취소');
  const total = kept.reduce((sum, row) => sum + row.금액, 0);
  const summary = [{ 기간: period, 주문건수: kept.length, 총매출: total, 평균주문금액: Math.round(total / kept.length) }];
  const byCategory = new Map();
  for (const row of kept) {
    const entry = byCategory.get(row.카테고리) ?? { 카테고리: row.카테고리, 주문건수: 0, 매출: 0 };
    entry.주문건수 += 1;
    entry.매출 += row.금액;
    byCategory.set(row.카테고리, entry);
  }
  const categories = [...byCategory.values()].sort((a, b) => b.매출 - a.매출);
  categories.push({ 카테고리: TOTAL_LABEL, 주문건수: kept.length, 매출: total });
  return { summary, categories };
}


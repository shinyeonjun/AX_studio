// Generates the "월간 매출 요약" demo fixtures deterministically (fixed seed), so the demo and its
// tests always see the same numbers. Run: node test/fixtures/demo/monthly-sales/generate.mjs
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { report } from './report.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const here = dirname(fileURLToPath(import.meta.url));

let seed = 20261006;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (items) => items[Math.floor(random() * items.length)];

const CATALOG = [
  { category: '생활용품', items: [['주방세제 1L', 4900], ['수세미 5입', 3500], ['밀폐용기 세트', 18900]] },
  { category: '식품', items: [['유기농 쌀 4kg', 21900], ['견과류 선물세트', 32000], ['드립커피 20입', 15800]] },
  { category: '전자기기', items: [['무선 이어폰', 59000], ['보조배터리 10000mAh', 27900], ['USB-C 충전기', 19800]] },
  { category: '문구', items: [['A4 복사지 500매', 6900], ['젤펜 12색', 8400], ['스프링 노트 5권', 7500]] },
];
const CUSTOMERS = ['한빛상사', '가온마트', '누리유통', '다솜스토어', '바른상회', '새봄리테일', '온길마켓', '하늘상점'];
const STATUSES = ['결제완료', '결제완료', '결제완료', '결제완료', '배송중', '취소'];

function orders(year, month, count) {
  const days = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, index) => {
    const { category, items } = pick(CATALOG);
    const [product, price] = pick(items);
    const quantity = 1 + Math.floor(random() * 5);
    const day = 1 + Math.floor(random() * days);
    return {
      주문일: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      주문번호: `ORD-${year}${String(month).padStart(2, '0')}-${String(index + 1).padStart(4, '0')}`,
      고객사: pick(CUSTOMERS),
      카테고리: category,
      상품명: product,
      수량: quantity,
      단가: price,
      금액: quantity * price,
      상태: pick(STATUSES),
    };
  }).sort((a, b) => a.주문일.localeCompare(b.주문일) || a.주문번호.localeCompare(b.주문번호));
}

function writeBook(path, sheets) {
  mkdirSync(dirname(path), { recursive: true });
  const book = XLSX.utils.book_new();
  for (const [sheetName, rows] of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), sheetName);
  XLSX.writeFile(book, path);
}

const august = orders(2026, 8, 180);
const september = orders(2026, 9, 210);
writeBook(join(here, 'input', '주문내역_2026-08.xlsx'), [['주문내역', august]]);
writeBook(join(here, 'next-month', '주문내역_2026-09.xlsx'), [['주문내역', september]]);

const augustReport = report('2026-08', august);
const septemberReport = report('2026-09', september);
writeBook(join(here, 'output', '월간매출요약_2026-08.xlsx'), [['요약', augustReport.summary], ['카테고리별', augustReport.categories]]);
// The true next-month report, only for tests that check what a learned workflow produces.
writeBook(join(here, 'expected', '월간매출요약_2026-09.xlsx'), [['요약', septemberReport.summary], ['카테고리별', septemberReport.categories]]);
console.log(JSON.stringify({ august: august.length, september: september.length, augustReport, septemberReport }, null, 1));

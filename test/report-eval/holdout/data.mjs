// Inventory movements for a held-out check: a domain the report fixes were never tuned on.
// Deterministic, so last month's and this month's reports are reproducible.
const ITEMS = [
  ['A-100', '복사용지 A4', 4200], ['A-210', '볼펜 0.5', 450], ['B-031', '토너 카트리지', 68000],
  ['B-115', '스테이플러', 7800], ['C-008', '파일철', 1200], ['C-420', '포스트잇', 900],
  ['D-002', '모니터암', 39000], ['D-310', 'USB 허브', 15500],
];
const WAREHOUSES = ['본사', '판교', '부산'];
const KINDS = ['입고', '출고', '출고', '출고', '반품'];

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function movements(period, seed) {
  const next = random(seed);
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = [];
  const count = 140 + Math.floor(next() * 60);
  for (let index = 0; index < count; index += 1) {
    const [code, name, price] = ITEMS[Math.floor(next() * ITEMS.length)];
    const quantity = 1 + Math.floor(next() * 40);
    rows.push({
      일자: `${period}-${String(1 + Math.floor(next() * days)).padStart(2, '0')}`,
      품목코드: code,
      품목명: name,
      창고: WAREHOUSES[Math.floor(next() * WAREHOUSES.length)],
      구분: KINDS[Math.floor(next() * KINDS.length)],
      수량: quantity,
      단가: price,
      금액: quantity * price,
    });
  }
  return rows.sort((left, right) => left.일자.localeCompare(right.일자));
}

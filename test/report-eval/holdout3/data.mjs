// Expense claims for a third held-out check. Deterministic per period.
const DEPARTMENTS = ['영업1팀', '영업2팀', '개발팀', '경영지원팀', '마케팅팀'];
const CATEGORIES = [['교통비', 8_000, 60_000], ['식대', 9_000, 45_000], ['숙박비', 70_000, 180_000], ['소모품', 5_000, 120_000], ['접대비', 50_000, 400_000]];

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 2 ** 32;
  };
}

export function expenses(period, seed) {
  const next = random(seed);
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = [];
  const count = 160 + Math.floor(next() * 70);
  for (let index = 0; index < count; index += 1) {
    const [category, low, high] = CATEGORIES[Math.floor(next() * CATEGORIES.length)];
    const amount = Math.round((low + next() * (high - low)) / 100) * 100;
    const roll = next();
    rows.push({
      청구일: `${period}-${String(1 + Math.floor(next() * days)).padStart(2, '0')}`,
      부서: DEPARTMENTS[Math.floor(next() * DEPARTMENTS.length)],
      항목: category,
      금액: amount,
      상태: roll < 0.8 ? '승인' : roll < 0.92 ? '반려' : '대기',
    });
  }
  return rows.sort((left, right) => left.청구일.localeCompare(right.청구일));
}

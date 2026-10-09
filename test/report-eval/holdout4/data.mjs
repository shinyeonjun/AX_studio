// Attendance records for a fourth held-out check: one row per person per working day.
const PEOPLE = [
  ['E101', '김민준', '생산1팀'], ['E102', '이서연', '생산1팀'], ['E103', '박도윤', '생산1팀'],
  ['E201', '최지우', '생산2팀'], ['E202', '정하준', '생산2팀'], ['E203', '강서아', '생산2팀'], ['E204', '조은우', '생산2팀'],
  ['E301', '윤지호', '품질팀'], ['E302', '장수아', '품질팀'],
];

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export function attendance(period, seed) {
  const next = random(seed);
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = [];
  for (let day = 1; day <= days; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const [id, name, team] of PEOPLE) {
      if (next() < 0.06) continue;
      const late = next() < 0.12;
      rows.push({
        일자: `${period}-${String(day).padStart(2, '0')}`,
        사번: id, 이름: name, 부서: team,
        지각: late ? 'Y' : 'N',
        초과근무: Math.round(next() * 6 * 2) / 2,
      });
    }
  }
  return rows;
}

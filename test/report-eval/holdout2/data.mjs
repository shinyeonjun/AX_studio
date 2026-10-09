// Customer support tickets for a second held-out check. Deterministic per period.
const CHANNELS = ['전화', '메일', '채팅', '채팅'];
const TYPES = ['배송', '환불', '제품', '기타'];

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 22695477) + 1) >>> 0;
    return state / 2 ** 32;
  };
}

export function tickets(period, seed) {
  const next = random(seed);
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = [];
  const count = 220 + Math.floor(next() * 80);
  for (let index = 0; index < count; index += 1) {
    const type = TYPES[Math.floor(next() * TYPES.length)];
    rows.push({
      접수번호: `T${period.replace('-', '')}-${String(index + 1).padStart(4, '0')}`,
      접수일: `${period}-${String(1 + Math.floor(next() * days)).padStart(2, '0')}`,
      채널: CHANNELS[Math.floor(next() * CHANNELS.length)],
      유형: type,
      처리상태: next() < 0.88 ? '완료' : '진행중',
      처리시간: 5 + Math.floor(next() * (type === '환불' ? 90 : 45)),
      만족도: 1 + Math.floor(next() * 5),
    });
  }
  return rows.sort((left, right) => left.접수일.localeCompare(right.접수일) || left.접수번호.localeCompare(right.접수번호));
}

// Fourth held-out report shapes over attendance. Written once; not adjusted to pass.
import { fixed } from '../round.mjs';

const hours = (value) => `${fixed(value, 1)}시간`;
const rate = (part, whole) => `${fixed(part / whole * 100, 1)}%`;

function sum(rows) {
  return rows.reduce((total, row) => total + row.초과근무, 0);
}

export function shapes(period, rows) {
  const [year, month] = period.split('-');
  const teams = [...new Set(rows.map((row) => row.부서))].sort();
  const people = [...new Set(rows.map((row) => row.사번))].map((id) => {
    const own = rows.filter((row) => row.사번 === id);
    return { name: own[0].이름, team: own[0].부서, overtime: sum(own) };
  }).sort((left, right) => right.overtime - left.overtime || left.name.localeCompare(right.name));
  const workdays = new Set(rows.map((row) => row.일자)).size;
  return {
    lateness: {
      header: '인사팀',
      title: `${Number(month)}월 부서별 지각 현황`,
      blocks: [
        { type: 'fields', items: [['근무일수', `${workdays}일`], ['전체 지각', `${rows.filter((row) => row.지각 === 'Y').length}회`]] },
        { type: 'table', columns: ['부서', '출근 기록', '지각', '지각률'], rows: teams.map((team) => {
          const own = rows.filter((row) => row.부서 === team);
          const late = own.filter((row) => row.지각 === 'Y').length;
          return [team, `${own.length}건`, `${late}회`, rate(late, own.length)];
        }) },
      ],
    },
    overtime: {
      title: '초과근무 상위자',
      blocks: [
        { type: 'text', text: `${year}년 ${Number(month)}월 초과근무는 모두 ${hours(sum(rows))}이며 1인 평균 ${hours(sum(rows) / people.length)}입니다.` },
        { type: 'table', columns: ['순위', '이름', '부서', '초과근무'],
          rows: people.slice(0, 3).map((person, index) => [String(index + 1), person.name, person.team, hours(person.overtime)]) },
      ],
    },
  };
}

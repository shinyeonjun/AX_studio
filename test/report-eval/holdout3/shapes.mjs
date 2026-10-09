// Third held-out report shapes over expense claims. Written once; not adjusted to pass.
import { fixed } from '../round.mjs';
const won = (value) => `₩${Math.round(value).toLocaleString('en-US')}`;
const count = (value) => `${value}건`;
const share = (part, whole) => `${fixed(part / whole * 100, 1)}%`;

function total(rows) {
  return rows.reduce((sum, row) => sum + row.금액, 0);
}

export function shapes(period, rows) {
  const [year, month] = period.split('-');
  const approved = rows.filter((row) => row.상태 === '승인');
  const departments = [...new Set(rows.map((row) => row.부서))]
    .map((name) => ({ name, rows: approved.filter((row) => row.부서 === name) }))
    .sort((left, right) => total(right.rows) - total(left.rows) || left.name.localeCompare(right.name));
  const categories = [...new Set(approved.map((row) => row.항목))]
    .map((name) => ({ name, amount: total(approved.filter((row) => row.항목 === name)) }))
    .sort((left, right) => right.amount - left.amount);
  return {
    department: {
      header: '재무팀 · 내부용',
      title: `부서별 경비 집행 내역 - ${year}.${month}`,
      blocks: [
        { type: 'fields', items: [['승인 금액 합계', won(total(approved))], ['승인 건수', count(approved.length)]] },
        { type: 'table', columns: ['부서', '건수', '금액', '1건당 평균'], rows: departments.map((entry) => [
          entry.name, count(entry.rows.length), won(total(entry.rows)), won(entry.rows.length ? total(entry.rows) / entry.rows.length : 0),
        ]) },
        { type: 'note', text: '반려·대기 건은 제외했습니다.' },
      ],
    },
    category: {
      title: '경비 항목별 비중',
      blocks: [
        { type: 'text', text: `${year}년 ${Number(month)}월 승인 경비 중 ${categories[0].name}가 ${share(categories[0].amount, total(approved))}로 가장 큽니다.` },
        { type: 'table', columns: ['항목', '금액', '비중'],
          rows: categories.map((entry) => [entry.name, won(entry.amount), share(entry.amount, total(approved))]) },
      ],
    },
    approval: {
      title: '경비 결재 현황',
      blocks: [
        { type: 'fields', items: [['기간', `${year}년 ${Number(month)}월`], ['청구 건수', count(rows.length)],
          ['반려율', share(rows.filter((row) => row.상태 === '반려').length, rows.length)]] },
        { type: 'table', columns: ['상태', '건수', '금액'], rows: ['승인', '반려', '대기'].map((status) => {
          const own = rows.filter((row) => row.상태 === status);
          return [status, count(own.length), won(total(own))];
        }) },
      ],
    },
  };
}

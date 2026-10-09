// Report shapes an office keeps every month, each built from one month's orders the way a person
// would have made it by hand. The same model is drawn as a PDF and as a Word file, so last month's
// file is the example and this month's is the answer to compare a generated report with.
const won = (value) => `${Math.round(value).toLocaleString('en-US')}원`;
const count = (value) => `${value}건`;
const percent = (value) => `${(value * 100).toFixed(1)}%`;

function monthLabel(period) {
  const [year, month] = period.split('-');
  return { year, month: Number(month), korean: `${year}년 ${Number(month)}월` };
}

function lastDay(period) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const entry = groups.get(row[key]) ?? { key: row[key], count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += row.금액;
    groups.set(row[key], entry);
  }
  return [...groups.values()];
}

export function shapes(period, rows) {
  const kept = rows.filter((row) => row.상태 !== '취소');
  const total = kept.reduce((sum, row) => sum + row.금액, 0);
  const label = monthLabel(period);
  const categories = groupBy(kept, '카테고리').sort((a, b) => b.amount - a.amount);
  const note = { type: 'note', text: '취소 주문은 제외했습니다. 출처: 주문내역 엑셀' };
  return {
    basic: {
      header: '영업관리팀 · 사내 보고용',
      title: '월간 매출 보고서',
      blocks: [
        { type: 'fields', items: [['기간', period]] },
        { type: 'fields', items: [['주문건수', count(kept.length)], ['총매출', won(total)], ['평균주문금액', won(total / kept.length)]] },
        { type: 'table', columns: ['카테고리', '주문건수', '매출'], rows: [
          ...categories.map((entry) => [entry.key, count(entry.count), won(entry.amount)]),
          ['합계', count(kept.length), won(total)],
        ] },
        note,
      ],
    },
    'korean-dates': {
      title: `${label.korean} 매출 보고서`,
      blocks: [
        { type: 'fields', items: [['기간', `${period.replace('-', '.')}.01 ~ ${period.replace('-', '.')}.${lastDay(period)}`]] },
        { type: 'fields', items: [['주문', count(kept.length)], ['매출', won(total)]] },
        { type: 'table', columns: ['카테고리', '주문건수', '매출'],
          rows: categories.map((entry) => [entry.key, count(entry.count), won(entry.amount)]) },
        note,
      ],
    },
    'share-sentence': {
      header: '경영지원실',
      title: '카테고리별 매출 현황',
      blocks: [
        { type: 'text', text: `${label.month}월 총매출은 ${won(total)}이며, 매출 1위 카테고리는 ${categories[0].key}(${percent(categories[0].amount / total)})입니다.` },
        { type: 'table', columns: ['카테고리', '매출', '비중', '건당 평균'], rows: categories.map((entry) => [
          entry.key, won(entry.amount), percent(entry.amount / total), won(entry.amount / entry.count),
        ]) },
        note,
      ],
    },
    'top-customers': {
      title: '주요 고객사 매출',
      blocks: [
        { type: 'fields', items: [['기간', label.korean], ['거래 고객사', `${new Set(kept.map((row) => row.고객사)).size}곳`]] },
        { type: 'text', text: '매출 상위 5개 고객사' },
        { type: 'table', columns: ['순위', '고객사', '주문건수', '매출'], rows: groupBy(kept, '고객사')
          .sort((a, b) => b.amount - a.amount).slice(0, 5)
          .map((entry, index) => [`${index + 1}`, entry.key, count(entry.count), won(entry.amount)]) },
        note,
      ],
    },
    daily: {
      title: '일별 매출 현황',
      blocks: [
        { type: 'fields', items: [['기간', period], ['영업일 평균 매출', won(total / new Set(kept.map((row) => row.주문일)).size)]] },
        { type: 'table', columns: ['일자', '주문건수', '매출'], rows: groupBy(kept, '주문일')
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((entry) => [entry.key, count(entry.count), won(entry.amount)]) },
        note,
      ],
    },
    status: {
      title: '주문 상태 현황',
      blocks: [
        { type: 'fields', items: [['기간', period], ['전체 주문', count(rows.length)], ['취소율', percent(rows.filter((row) => row.상태 === '취소').length / rows.length)]] },
        { type: 'table', columns: ['상태', '건수', '금액'], rows: groupBy(rows, '상태')
          .sort((a, b) => b.count - a.count)
          .map((entry) => [entry.key, count(entry.count), won(entry.amount)]) },
        { type: 'note', text: '출처: 주문내역 엑셀' },
      ],
    },
  };
}

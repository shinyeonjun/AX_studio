// Held-out report shapes over inventory movements. Written once; not adjusted to pass.
const won = (value) => `${Math.round(value).toLocaleString('en-US')}원`;
const pieces = (value) => `${value.toLocaleString('en-US')}개`;
const signed = (value) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toLocaleString('en-US')}`;

function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function lastDay(period) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function shapes(period, rows) {
  const [year, month] = period.split('-');
  const korean = `${year}년 ${Number(month)}월`;
  const inbound = rows.filter((row) => row.구분 === '입고');
  const outbound = rows.filter((row) => row.구분 === '출고');
  const returns = rows.filter((row) => row.구분 === '반품');
  const warehouses = [...new Set(rows.map((row) => row.창고))].sort();
  const items = [...new Set(outbound.map((row) => row.품목명))].map((name) => {
    const own = outbound.filter((row) => row.품목명 === name);
    return { name, quantity: sum(own, '수량'), amount: sum(own, '금액') };
  }).sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name));
  return {
    warehouse: {
      header: '물류팀',
      title: `창고별 입출고 현황 (${korean})`,
      blocks: [
        { type: 'fields', items: [['입고 합계', pieces(sum(inbound, '수량'))], ['출고 합계', pieces(sum(outbound, '수량'))]] },
        { type: 'table', columns: ['창고', '입고', '출고', '순증감'], rows: warehouses.map((name) => {
          const inQty = sum(inbound.filter((row) => row.창고 === name), '수량');
          const outQty = sum(outbound.filter((row) => row.창고 === name), '수량');
          return [name, pieces(inQty), pieces(outQty), signed(inQty - outQty)];
        }) },
        { type: 'note', text: '반품은 별도 집계합니다.' },
      ],
    },
    'top-items': {
      title: '출고 상위 품목',
      blocks: [
        { type: 'fields', items: [['대상 기간', `${year}/${month}`]] },
        { type: 'text', text: `${Number(month)}월 최다 출고 품목은 ${items[0].name}(${pieces(items[0].quantity)})입니다.` },
        { type: 'table', columns: ['순위', '품목명', '출고수량', '출고금액'],
          rows: items.slice(0, 3).map((item, index) => [`${index + 1}위`, item.name, pieces(item.quantity), won(item.amount)]) },
      ],
    },
    returns: {
      title: '반품 현황',
      blocks: [
        { type: 'fields', items: [['기준일', `${period}-${lastDay(period)}`], ['반품 건수', `${returns.length}건`],
          ['반품률', `${(returns.length / outbound.length * 100).toFixed(2)}%`]] },
        { type: 'table', columns: ['구분', '건수', '수량', '금액'], rows: ['입고', '출고', '반품'].map((kind) => {
          const own = rows.filter((row) => row.구분 === kind);
          return [kind, `${own.length}건`, pieces(sum(own, '수량')), won(sum(own, '금액'))];
        }) },
        { type: 'note', text: '반품률은 반품 건수를 출고 건수로 나눈 값입니다.' },
      ],
    },
  };
}

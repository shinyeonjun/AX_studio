// Second held-out report shapes over support tickets. Written once; not adjusted to pass.
import { fixed } from '../round.mjs';
const count = (value) => `${value.toLocaleString('en-US')}건`;
const rate = (part, whole) => `${fixed(part / whole * 100, 1)}%`;
const minutes = (value) => `${fixed(value, 1)}분`;
const points = (value) => `${fixed(value, 2)}점`;

function average(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0) / rows.length;
}

function lastDay(period) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function shapes(period, rows) {
  const month = Number(period.split('-')[1]);
  const done = rows.filter((row) => row.처리상태 === '완료');
  const channels = ['전화', '메일', '채팅'];
  const types = [...new Set(rows.map((row) => row.유형))]
    .map((type) => ({ type, rows: rows.filter((row) => row.유형 === type) }))
    .sort((left, right) => right.rows.length - left.rows.length || left.type.localeCompare(right.type));
  return {
    channel: {
      header: '고객지원팀 월간 보고',
      title: '채널별 문의 처리 현황',
      blocks: [
        { type: 'fields', items: [['집계 기간', `${month}월 1일 ~ ${month}월 ${lastDay(period)}일`]] },
        { type: 'fields', items: [['총 접수', count(rows.length)], ['처리 완료', count(done.length)], ['처리율', rate(done.length, rows.length)]] },
        { type: 'table', columns: ['채널', '접수', '완료', '처리율'], rows: channels.map((channel) => {
          const own = rows.filter((row) => row.채널 === channel);
          const finished = own.filter((row) => row.처리상태 === '완료');
          return [channel, count(own.length), count(finished.length), rate(finished.length, own.length)];
        }) },
      ],
    },
    'handling-time': {
      title: '유형별 처리 시간',
      blocks: [
        { type: 'text', text: `${month}월 문의는 모두 ${count(rows.length)}이며 가장 많은 유형은 ${types[0].type}입니다.` },
        { type: 'table', columns: ['유형', '건수', '평균 처리시간'],
          rows: types.map((entry) => [entry.type, count(entry.rows.length), minutes(average(entry.rows, '처리시간'))]) },
        { type: 'note', text: '처리시간은 접수부터 답변 완료까지의 분 단위 시간입니다.' },
      ],
    },
    satisfaction: {
      header: 'CS 품질',
      title: '고객 만족도',
      blocks: [
        { type: 'fields', items: [['대상', `${period} 접수분`], ['평균 만족도', points(average(rows, '만족도'))]] },
        { type: 'table', columns: ['점수', '응답 수', '비율'], rows: [5, 4, 3, 2, 1].map((score) => {
          const own = rows.filter((row) => row.만족도 === score);
          return [`${score}점`, count(own.length), rate(own.length, rows.length)];
        }) },
      ],
    },
  };
}

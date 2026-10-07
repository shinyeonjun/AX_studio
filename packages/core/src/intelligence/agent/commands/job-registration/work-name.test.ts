import { describe, expect, it } from 'vitest';
import { workNameFromRequest } from './work-name.js';

describe('the name a work gets from its request', () => {
  it.each([
    ['Gmail 새 메일이 오면 요약해서 #ops로 알려주는 반복 업무를 만들어줘', 'Gmail 새 메일이 오면 요약해서 #ops로 알려주는 업무'],
    ['매일 아침 9시에 주문 요약을 Slack으로 보내줘', '매일 아침 9시에 주문 요약을 Slack으로 보내줘'],
    ['재고 10개 미만 상품 표', '재고 10개 미만 상품 표'],
    ['만들어줘', '반복 조회'],
  ])('%s -> %s', (request, expected) => {
    expect(workNameFromRequest(request, '반복 조회')).toBe(expected);
  });

  it('keeps a long name short', () => {
    expect(workNameFromRequest('가'.repeat(80), 'x')).toHaveLength(40);
  });
});

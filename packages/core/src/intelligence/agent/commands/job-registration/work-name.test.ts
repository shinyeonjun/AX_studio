import { describe, expect, it } from 'vitest';
import { workNameFromRequest } from './work-name.js';
import type { AgentHarness } from '../../harness.js';

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

describe('suggestWorkName', () => {
  const harness = (output: string | Error): Pick<AgentHarness, 'runText'> => ({
    runText: async () => {
      if (output instanceof Error) throw output;
      return { output, role: 'command', provider: 'test', durationMs: 1, promptChars: 1 } as Awaited<ReturnType<AgentHarness['runText']>>;
    },
  });

  it('takes the short name the AI gives, without quotes or a period', async () => {
    const { suggestWorkName } = await import('./work-name.js');
    expect(await suggestWorkName(harness('"반품 주문 확인".'), '반품된 주문만 보여줘')).toBe('반품 주문 확인');
  });

  it('gives up on anything that is not a short one-line name, or when the AI fails', async () => {
    const { suggestWorkName } = await import('./work-name.js');
    expect(await suggestWorkName(harness('반품 주문 확인\n이 이름은 반품된 주문을 매번 확인하는 업무라서 지었습니다'), '반품된 주문만 보여줘')).toBeUndefined();
    expect(await suggestWorkName(harness('가'.repeat(40)), '요청')).toBeUndefined();
    expect(await suggestWorkName(harness(new Error('provider down')), '요청')).toBeUndefined();
    expect(await suggestWorkName(harness('이름'), '   ')).toBeUndefined();
  });
});

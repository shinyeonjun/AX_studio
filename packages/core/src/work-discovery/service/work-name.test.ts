import { describe, expect, it } from 'vitest';
import { learnedWorkName } from './work-name.js';

describe('the name a learned work gets', () => {
  it('is what its result files are called, apart from the period', () => {
    expect(learnedWorkName(['매출보고서_2026-08.pdf', '매출보고서_2026-09.pdf'])).toBe('매출보고서 만들기');
    expect(learnedWorkName(['report.pdf', 'report (1).pdf'])).toBe('report 만들기');
  });

  it('is left to the request when the files are different things or carry no name', () => {
    expect(learnedWorkName(['매출보고서_08.pdf', '재고현황_08.pdf'])).toBeUndefined();
    expect(learnedWorkName(['2026-08.pdf'])).toBeUndefined();
    expect(learnedWorkName([])).toBeUndefined();
  });
});

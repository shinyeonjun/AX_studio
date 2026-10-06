import { describe, expect, it } from 'vitest';
import { koreanScheduleToCron } from './cron-natural.js';

describe('koreanScheduleToCron', () => {
  it.each([
    ['매일 오전 9시에 재고를 확인해줘', '0 9 * * *'],
    ['매일 아침 9시 30분', '30 9 * * *'],
    ['평일 오후 6시 반에 보내줘', '30 18 * * 1-5'],
    ['주말 오전 10시', '0 10 * * 0,6'],
    ['매주 월요일 10시에', '0 10 * * 1'],
    ['매월 1일 오전 9시', '0 9 1 * *'],
    ['30분마다 확인해줘', '*/30 * * * *'],
    ['매시간 체크', '0 * * * *'],
    ['매일 밤 12시', '0 0 * * *'],
    ['매일 오후 12시', '0 12 * * *'],
    ['매일 새벽 12시', '0 0 * * *'],
  ])('%s -> %s', (text, cron) => {
    expect(koreanScheduleToCron(text)).toBe(cron);
  });

  it.each([
    '9시에 보내줘',
    '내일 오전 9시',
    '매일 25시',
    '매월 40일 9시',
    '자주 확인해줘',
  ])('leaves ambiguous or invalid phrases to the user: %s', (text) => {
    expect(koreanScheduleToCron(text)).toBeUndefined();
  });
});

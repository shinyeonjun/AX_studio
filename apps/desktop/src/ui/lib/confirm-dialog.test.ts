import { describe, expect, it } from 'vitest';
import { pendingConfirm, requestConfirm } from './confirm-dialog';
import { confirmDeleteWork } from './confirm-delete';

describe('app confirmations', () => {
  it('asks to delete a work, keeping its run history unless the box is ticked', async () => {
    const kept = confirmDeleteWork('주간 보고');
    const asked = pendingConfirm()!;
    expect(asked.request).toMatchObject({ title: '"주간 보고" 업무를 삭제할까요?', confirmLabel: '업무 삭제', danger: true, option: { label: '실행 기록도 함께 지우기' } });
    expect(asked.request.message).toContain('실행 기록(무엇을 보냈는지 포함)은 활동에 그대로 남습니다');
    asked.resolve({ confirmed: true, optionChecked: false });
    await expect(kept).resolves.toEqual({ confirmed: true, deleteHistory: false });
    expect(pendingConfirm()).toBeUndefined();

    const cleared = confirmDeleteWork('주간 보고');
    pendingConfirm()!.resolve({ confirmed: true, optionChecked: true });
    await expect(cleared).resolves.toEqual({ confirmed: true, deleteHistory: true });
  });

  it('answers an unanswered request as cancelled when another one opens', async () => {
    const first = requestConfirm({ title: 'A?', confirmLabel: '확인' });
    const second = requestConfirm({ title: 'B?', confirmLabel: '확인' });
    await expect(first).resolves.toEqual({ confirmed: false, optionChecked: false });
    expect(pendingConfirm()?.request.title).toBe('B?');
    pendingConfirm()!.resolve({ confirmed: false, optionChecked: false });
    await expect(second).resolves.toMatchObject({ confirmed: false });
  });
});

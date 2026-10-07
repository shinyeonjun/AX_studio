import { describe, expect, it } from 'vitest';
import { ipcErrorMessage } from './ipc-error';

describe('the error a person sees from a failed request', () => {
  it('keeps a readable message and drops the IPC wrapper', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'ax:x': Error: 폴더를 찾을 수 없습니다."))).toBe('폴더를 찾을 수 없습니다.');
    expect(ipcErrorMessage(new Error('Error: 연결 실패'))).toBe('연결 실패');
  });

  it('never shows validation output or other internals', () => {
    const zod = `Error invoking remote method 'ax:discoveryPublish': [ { "code": "too_big", "path": ["outputContract"] } ]`;
    expect(ipcErrorMessage(new Error(zod), '저장하지 못했습니다.')).toBe('저장하지 못했습니다.');
    expect(ipcErrorMessage(new Error(`Error invoking remote method 'ax:y': ZodError: [{"code":"x"}]`))).toBe('요청 처리에 실패했습니다.');
  });
});

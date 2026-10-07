import { afterEach, describe, expect, it, vi } from 'vitest';
import { userFacingError } from './user-facing-error.js';

describe('error text an IPC result carries to the screen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps our own Korean message', () => {
    expect(userFacingError(new Error('PDF 파일만 추가할 수 있어요.'), '추가하지 못했어요.')).toBe('PDF 파일만 추가할 수 있어요.');
  });

  it('replaces system and library text with the fallback, keeping it in the log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(userFacingError(new Error("ENOENT: no such file or directory, open 'x'"), '추가하지 못했어요.')).toBe('추가하지 못했어요.');
    expect(userFacingError('[{"code":"too_big"}]', '추가하지 못했어요.')).toBe('추가하지 못했어요.');
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('ENOENT'));
  });
});

describe('system errors naming Korean paths', () => {
  it('are replaced even though the path is Korean, while Korean sentences stay', () => {
    expect(userFacingError(new Error("ENOENT: no such file or directory, stat 'C:\업무자료\a.xlsx'"), '파일을 가져오지 못했어요.')).toBe('파일을 가져오지 못했어요.');
    expect(userFacingError(new Error('EXCEL 파일이 비어 있어요.'), 'x')).toBe('EXCEL 파일이 비어 있어요.');
  });
});

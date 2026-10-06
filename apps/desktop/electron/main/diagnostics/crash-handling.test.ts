import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, crashReporter: { start: vi.fn() }, dialog: {} }));
vi.mock('@ax-studio/core', () => ({ appendAppLog: vi.fn(), flushAppLogSync: vi.fn() }));
vi.mock('../file-log.js', () => ({ getDesktopLogDirectory: () => '/logs' }));

import { appendAppLog, flushAppLogSync } from '@ax-studio/core';
import { handleFatalMainError, resetFatalHandlingForTest, type FatalErrorDeps } from './crash-handling.js';

function deps(overrides: Partial<FatalErrorDeps> = {}): FatalErrorDeps {
  return {
    isPackaged: true,
    recordCrash: vi.fn(() => true),
    showErrorBox: vi.fn(),
    markQuitting: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
    logDirectory: () => '/logs',
    ...overrides,
  };
}

describe('handleFatalMainError', () => {
  beforeEach(() => {
    resetFatalHandlingForTest();
    vi.mocked(appendAppLog).mockClear();
    vi.mocked(flushAppLogSync).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('only logs in unpackaged runs', () => {
    const d = deps({ isPackaged: false });
    handleFatalMainError(new Error('boom'), d);
    expect(flushAppLogSync).toHaveBeenCalled();
    expect(d.recordCrash).not.toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('flushes, informs the user and relaunches when below the crash limit', () => {
    const d = deps();
    handleFatalMainError(new Error('boom'), d);
    expect(flushAppLogSync).toHaveBeenCalled();
    expect(d.showErrorBox).toHaveBeenCalledWith('AX Studio 오류', expect.stringContaining('다시 시작합니다'));
    expect(d.showErrorBox).toHaveBeenCalledWith('AX Studio 오류', expect.stringContaining('/logs'));
    expect(d.markQuitting).toHaveBeenCalled();
    expect(d.relaunch).toHaveBeenCalled();
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('exits without relaunching in a crash loop', () => {
    const d = deps({ recordCrash: vi.fn(() => false) });
    handleFatalMainError('loop', d);
    expect(appendAppLog).toHaveBeenCalledWith('error', expect.stringContaining('crash loop'));
    expect(d.showErrorBox).toHaveBeenCalledWith('AX Studio 오류', expect.stringContaining('자동 재시작을 중단'));
    expect(d.relaunch).not.toHaveBeenCalled();
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('still exits when the dialog throws, and handles only the first fatal error', () => {
    const d = deps({ showErrorBox: vi.fn(() => { throw new Error('no display'); }) });
    handleFatalMainError(new Error('first'), d);
    handleFatalMainError(new Error('second'), d);
    expect(d.exit).toHaveBeenCalledTimes(1);
    expect(d.recordCrash).toHaveBeenCalledTimes(1);
  });
});

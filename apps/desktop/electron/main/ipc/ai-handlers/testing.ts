import { ipcHandle } from '../ipc-handle.js';
import { isAiBrand } from '@ax-studio/core';
import { testAiCli } from '../../ai/cli-test.js';

const UNSUPPORTED_BRAND = '지원하지 않는 AI 제공자입니다.';

export function registerAiTestingHandlers(): void {
  ipcHandle('ax:testAiCli', async (_event, brand: unknown) => {
    if (!isAiBrand(brand)) throw new Error(UNSUPPORTED_BRAND);
    return testAiCli(brand);
  });
}

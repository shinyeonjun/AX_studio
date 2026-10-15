import { ipcHandle } from '../ipc-handle.js';
import { CLI_PROVIDER_META, CLI_PROVIDER_IDS, detectAiCliProviders, resolveBinaryAsync } from '@ax-studio/core';
import { getAiConfigPath, readAiToml } from '../../ai/config-file.js';

export function registerAiInspectionHandlers(): void {
  // Warm the binary cache off the IPC path so the first state snapshot sees installed CLIs.
  for (const id of CLI_PROVIDER_IDS) void resolveBinaryAsync(CLI_PROVIDER_META[id].binaries).catch(() => undefined);

  ipcHandle('ax:detectAiCli', async () => detectAiCliProviders());

  ipcHandle('ax:getAiConfig', async () => {
    const config = await readAiToml();
    return {
      path: getAiConfigPath(),
      active: config.active ? { brand: config.active.brand, model: config.active.model } : undefined,
      providers: config.providers,
    };
  });
}

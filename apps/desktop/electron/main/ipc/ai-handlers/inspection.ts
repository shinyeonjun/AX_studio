import { ipcHandle } from '../ipc-handle.js';
import { AI_BRANDS, CLI_PROVIDER_META, CLI_PROVIDER_IDS, detectAiCliProviders, resolveBinaryAsync } from '@ax-studio/core';
import {
  getAiConfigPath,
  getSecretForBrand,
  readAiToml,
} from '../../ai/config-file.js';
import { maskSecret } from '../../env-file.js';

export function registerAiInspectionHandlers(): void {
  // Warm the binary cache off the IPC path so the first state snapshot sees installed CLIs.
  for (const id of CLI_PROVIDER_IDS) void resolveBinaryAsync(CLI_PROVIDER_META[id].binaries).catch(() => undefined);

  ipcHandle('ax:detectAiCli', async () => detectAiCliProviders());

  ipcHandle('ax:getAiConfig', async () => {
    const config = await readAiToml();
    return {
      path: getAiConfigPath(),
      active: config.active,
      providers: config.providers,
      secrets: Object.fromEntries(
        await Promise.all(
          AI_BRANDS.map(async (brand) => {
            const val = await getSecretForBrand(brand);
            return [brand, { configured: Boolean(val), masked: val ? maskSecret(val) : undefined }];
          }),
        ),
      ),
    };
  });
}

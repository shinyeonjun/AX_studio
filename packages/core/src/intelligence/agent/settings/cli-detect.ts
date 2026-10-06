import { CLI_PROVIDER_META, normalizeModelOptions, parseCodexModelsOutput, type CliModelOption } from './catalog.js';
import { invalidateBinaryCache, resolveBinary, resolveBinaryAsync, runCommand } from '../model/cli-process.js';
import { CLI_PROVIDER_IDS, type CliProviderId } from './ai-provider-id.js';

export interface DetectedAiCli {
  id: CliProviderId;
  label: string;
  description: string;
  installed: boolean;
  command?: string;
  version?: string;
  models: CliModelOption[];
  defaultModel: string;
}

async function readVersion(command: string): Promise<string | undefined> {
  const result = await runCommand(command, ['--version'], { timeoutMs: 8000 });
  const text = `${result.stdout}\n${result.stderr}`.trim();
  return text.split(/\r?\n/)[0]?.trim() || undefined;
}

async function readCodexModels(command: string): Promise<CliModelOption[]> {
  const result = await runCommand(command, ['debug', 'models'], { timeoutMs: 4000 });
  return parseCodexModelsOutput(result.stdout || result.stderr);
}

/** Cached and non-blocking; safe to call from state snapshots. */
export function isAiCliInstalled(id: CliProviderId): boolean {
  return Boolean(resolveBinary(CLI_PROVIDER_META[id].binaries));
}

export async function detectAiCliProviders(): Promise<DetectedAiCli[]> {
  // Explicit detection is the user's "re-check" action, so it must not reuse stale lookups.
  invalidateBinaryCache();
  return Promise.all(CLI_PROVIDER_IDS.map(async (id) => {
    const meta = CLI_PROVIDER_META[id];
    const fallbackModels = normalizeModelOptions(meta.models);
    const command = await resolveBinaryAsync(meta.binaries);
    if (!command) {
      return {
        id,
        label: meta.label,
        description: meta.description,
        installed: false,
        models: fallbackModels,
        defaultModel: meta.defaultModel,
      };
    }

    const [version, codexModels] = await Promise.all([
      readVersion(command).catch(() => undefined),
      id === 'codex-cli' ? readCodexModels(command).catch(() => []) : Promise.resolve([]),
    ]);
    const detectedModels = normalizeModelOptions(codexModels);
    return {
      id,
      label: meta.label,
      description: version ? `${meta.description} · ${version}` : meta.description,
      installed: true,
      command,
      version,
      models: detectedModels.length > 0 ? detectedModels : fallbackModels,
      defaultModel: meta.defaultModel,
    };
  }));
}

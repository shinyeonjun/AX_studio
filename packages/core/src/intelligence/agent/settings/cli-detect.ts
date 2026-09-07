import { CLI_PROVIDER_META, normalizeModelOptions, parseCodexModelsOutput, type CliModelOption } from './catalog.js';
import { resolveBinary, runCommand } from '../model/cli-process.js';
import type { CliProviderId } from './ai-provider-id.js';

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
  const parsed = parseCodexModelsOutput(result.stdout || result.stderr);
  return parsed;
}

export function isCursorApiKeyConfigured(): boolean {
  return Boolean(process.env.CURSOR_API_KEY?.trim());
}

export function isAiCliInstalled(id: CliProviderId): boolean {
  if (id === 'cursor-cli') {
    return Boolean(resolveBinary(CLI_PROVIDER_META[id].binaries)) && isCursorApiKeyConfigured();
  }
  return Boolean(resolveBinary(CLI_PROVIDER_META[id].binaries));
}

export async function detectAiCliProviders(): Promise<DetectedAiCli[]> {
  const ids: CliProviderId[] = ['codex-cli', 'claude-cli', 'cursor-cli'];
  const detected: DetectedAiCli[] = [];
  for (const id of ids) {
    const meta = CLI_PROVIDER_META[id];
    const command = resolveBinary(meta.binaries);
    const hasCursorKey = id === 'cursor-cli' && isCursorApiKeyConfigured();
    if (!command && !hasCursorKey) {
      detected.push({
        id,
        label: meta.label,
        description: meta.description,
        installed: false,
        models: normalizeModelOptions(meta.models),
        defaultModel: meta.defaultModel,
      });
      continue;
    }

    if (!command && hasCursorKey) {
      detected.push({
        id,
        label: meta.label,
        description: 'API 키 등록됨 · agent CLI 미설치',
        installed: false,
        models: normalizeModelOptions(meta.models),
        defaultModel: meta.defaultModel,
      });
      continue;
    }

    if (!command) {
      detected.push({
        id,
        label: meta.label,
        description: meta.description,
        installed: false,
        models: normalizeModelOptions(meta.models),
        defaultModel: meta.defaultModel,
      });
      continue;
    }

    const version = await readVersion(command).catch(() => undefined);
    const hasCursorKeyForRuntime = id !== 'cursor-cli' || isCursorApiKeyConfigured();
    const detectedModels =
      id === 'claude-cli'
        ? normalizeModelOptions(meta.models)
        : id === 'codex-cli'
          ? normalizeModelOptions(await readCodexModels(command!).catch(() => []))
          : [];
    const models =
      detectedModels.length > 0 ? detectedModels : normalizeModelOptions(meta.models);
    const defaultModel = meta.defaultModel;
    const description =
      id === 'cursor-cli' && !hasCursorKeyForRuntime
        ? `${meta.description} · agent 설치됨 · API 키 필요`
        : version
          ? `${meta.description} · ${version}`
          : meta.description;
    detected.push({
      id,
      label: meta.label,
      description,
      installed: hasCursorKeyForRuntime,
      command,
      version,
      models,
      defaultModel,
    });
  }
  return detected;
}

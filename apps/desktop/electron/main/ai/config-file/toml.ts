import type { AiBrand, AiConnectionMode } from '@ax-studio/core';
import type { AiTomlConfig } from './contracts.js';

export function emptyConfig(): AiTomlConfig {
  return { providers: {}, secrets: {} };
}

function parseTomlValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function unescapeTomlString(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
}

export function parseAiToml(content: string): AiTomlConfig {
  const config = emptyConfig();
  let section = '';

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = unescapeTomlString(parseTomlValue(trimmed.slice(eq + 1)));

    if (section === 'active') {
      config.active ??= { brand: 'claude', mode: 'cli', model: 'sonnet' };
      if (key === 'brand') config.active.brand = value as AiBrand;
      if (key === 'mode') config.active.mode = value as AiConnectionMode;
      if (key === 'model') config.active.model = value;
      continue;
    }

    if (section === 'secrets') {
      config.secrets[key] = value;
      continue;
    }

    const providerMatch = section.match(/^providers\.(.+)$/);
    if (providerMatch) {
      const brand = providerMatch[1] as AiBrand;
      config.providers[brand] ??= {};
      if (key === 'mode') config.providers[brand]!.mode = value as AiConnectionMode;
      if (key === 'model') config.providers[brand]!.model = value;
    }
  }

  return config;
}

function escapeTomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function serializeAiToml(config: AiTomlConfig): string {
  const lines = [
    '# AX Studio AI settings',
    '# 개발: 프로젝트 루트 ai.toml / 릴리즈: %LOCALAPPDATA%\\AXStudio\\config\\ai.toml',
    '# API 키는 이 파일에 저장하지 않습니다.',
    '',
  ];

  if (config.active) {
    lines.push(
      '[active]',
      `brand = ${escapeTomlString(config.active.brand)}`,
      `mode = ${escapeTomlString(config.active.mode)}`,
      `model = ${escapeTomlString(config.active.model)}`,
      '',
    );
  }

  for (const [brand, provider] of Object.entries(config.providers)) {
    if (!provider) continue;
    lines.push(`[providers.${brand}]`);
    if (provider.mode) lines.push(`mode = ${escapeTomlString(provider.mode)}`);
    if (provider.model) lines.push(`model = ${escapeTomlString(provider.model)}`);
    lines.push('');
  }

  return lines.join('\n');
}

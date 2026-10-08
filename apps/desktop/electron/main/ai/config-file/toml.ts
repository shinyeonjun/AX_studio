import { isAiBrand, type AiConnectionMode } from '@ax-studio/core';
import type { AiTomlConfig } from './contracts.js';

export function emptyConfig(): AiTomlConfig {
  return { providers: {}, secrets: {} };
}

const ESCAPES: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

/** TOML basic string body starting after the opening quote; returns the decoded text. */
function readBasicString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (char === '"') return out;
    if (char !== '\\') { out += char; continue; }
    const next = raw[i + 1] ?? '';
    if (next === 'u' || next === 'U') {
      const length = next === 'u' ? 4 : 8;
      const code = Number.parseInt(raw.slice(i + 2, i + 2 + length), 16);
      if (Number.isFinite(code)) out += String.fromCodePoint(code);
      i += 1 + length;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i += 1;
  }
  return out;
}

/** Decodes one TOML scalar, ignoring a trailing `# comment`. */
export function parseTomlValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) return readBasicString(trimmed.slice(1));
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1);
    return end < 0 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  const comment = trimmed.indexOf('#');
  return (comment < 0 ? trimmed : trimmed.slice(0, comment)).trim();
}

function parseMode(value: string): AiConnectionMode | undefined {
  return value === 'cli' || value === 'api' ? value : undefined;
}

export function parseAiToml(content: string): AiTomlConfig {
  const config = emptyConfig();
  let section = '';
  let active: Partial<NonNullable<AiTomlConfig['active']>> | undefined;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = parseTomlValue(trimmed.slice(eq + 1));

    if (section === 'active') {
      active ??= {};
      if (key === 'brand' && isAiBrand(value)) active.brand = value;
      if (key === 'mode') active.mode = parseMode(value);
      if (key === 'model') active.model = value;
      continue;
    }

    if (section === 'decision.jev') {
      config.decision ??= {};
      config.decision.jev ??= {};
      if (key === 'enabled') config.decision.jev.enabled = value === 'true';
      if (key === 'model') config.decision.jev.model = value;
      if (key === 'base_url') config.decision.jev.baseURL = value;
      if (key === 'key_origin') config.decision.jev.keyOrigin = value;
      if (key === 'verified_key') config.decision.jev.verifiedKey = value;
      continue;
    }
    if (section === 'secrets') {
      config.secrets[key] = value;
      continue;
    }

    // Removed brands (Grok/Cursor) are dropped so the next save forgets them.
    const brand = section.match(/^providers\.(.+)$/)?.[1];
    if (brand && isAiBrand(brand)) {
      const provider = (config.providers[brand] ??= {});
      if (key === 'mode') provider.mode = parseMode(value);
      if (key === 'model') provider.model = value;
    }
  }

  if (active?.brand && active.mode) {
    config.active = { brand: active.brand, mode: active.mode, model: active.model ?? '' };
  }
  return config;
}

export function escapeTomlString(value: string): string {
  const body = value.replace(/[\\"\u0000-\u001f\u007f]/g, (char) => {
    const named = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' }[char];
    return named ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return `"${body}"`;
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
    if (!provider || !isAiBrand(brand)) continue;
    lines.push(`[providers.${brand}]`);
    if (provider.mode) lines.push(`mode = ${escapeTomlString(provider.mode)}`);
    if (provider.model) lines.push(`model = ${escapeTomlString(provider.model)}`);
    lines.push('');
  }

  const jev = config.decision?.jev;
  if (jev) {
    lines.push('[decision.jev]');
    if (jev.enabled !== undefined) lines.push(`enabled = ${jev.enabled ? 'true' : 'false'}`);
    if (jev.model) lines.push(`model = ${escapeTomlString(jev.model)}`);
    if (jev.baseURL) lines.push(`base_url = ${escapeTomlString(jev.baseURL)}`);
    if (jev.keyOrigin) lines.push(`key_origin = ${escapeTomlString(jev.keyOrigin)}`);
    if (jev.verifiedKey) lines.push(`verified_key = ${escapeTomlString(jev.verifiedKey)}`);
    lines.push('');
  }
  return lines.join('\n');
}

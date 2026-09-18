import { JevDecisionEngine } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import {
  getJevSecret,
  readAiToml,
  saveJevDecisionPreferences,
  setJevSecret,
} from '../../ai/config-file.js';
import { maskSecret } from '../../env-file.js';

const DEFAULT_JEV_MODEL = 'jev-latest';
const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai';

interface JevDecisionPrefs {
  enabled?: boolean;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

function normalizedUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_JEV_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Jev Base URL 형식이 올바르지 않습니다.');
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('Jev Base URL은 HTTPS여야 합니다. 개발용 HTTP는 loopback 주소만 허용됩니다.');
  }
  return candidate.replace(/\/+$/, '');
}

function normalizePrefs(raw: unknown): Required<Pick<JevDecisionPrefs, 'enabled' | 'model' | 'baseURL'>> & Pick<JevDecisionPrefs, 'apiKey'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Jev 설정 형식이 올바르지 않습니다.');
  }
  const prefs = raw as JevDecisionPrefs;
  if (prefs.enabled !== undefined && typeof prefs.enabled !== 'boolean') {
    throw new Error('Jev 사용 여부 형식이 올바르지 않습니다.');
  }
  if (prefs.model !== undefined && typeof prefs.model !== 'string') {
    throw new Error('Jev 모델 형식이 올바르지 않습니다.');
  }
  if (prefs.baseURL !== undefined && typeof prefs.baseURL !== 'string') {
    throw new Error('Jev Base URL 형식이 올바르지 않습니다.');
  }
  if (prefs.apiKey !== undefined && typeof prefs.apiKey !== 'string') {
    throw new Error('Jev API 키 형식이 올바르지 않습니다.');
  }
  return {
    enabled: prefs.enabled ?? false,
    model: prefs.model?.trim() || DEFAULT_JEV_MODEL,
    baseURL: normalizedUrl(prefs.baseURL),
    ...(prefs.apiKey === undefined ? {} : { apiKey: prefs.apiKey }),
  };
}

async function snapshot() {
  const config = await readAiToml();
  const jev = config.decision?.jev;
  const secret = await getJevSecret();
  return {
    enabled: jev?.enabled ?? false,
    model: jev?.model?.trim() || DEFAULT_JEV_MODEL,
    baseURL: jev?.baseURL?.trim() || DEFAULT_JEV_BASE_URL,
    apiKeyConfigured: Boolean(secret),
    apiKeyMasked: secret ? maskSecret(secret) : undefined,
  };
}

export function registerDecisionPlaneHandlers(): void {
  ipcHandle('ax:getJevDecisionConfig', async () => snapshot());

  ipcHandle('ax:saveJevDecisionConfig', async (_event, raw: unknown) => {
    const prefs = normalizePrefs(raw);
    if (prefs.apiKey?.trim()) await setJevSecret(prefs.apiKey.trim());
    const secret = await getJevSecret();
    if (prefs.enabled && !secret) {
      throw new Error('Jev를 사용하려면 API 키를 먼저 등록하세요.');
    }

    await saveJevDecisionPreferences({
      enabled: prefs.enabled,
      model: prefs.model,
      baseURL: prefs.baseURL,
    });

    getCore().refreshDecisionEngine(
      prefs.enabled
        ? new JevDecisionEngine({
            apiKey: secret,
            model: prefs.model,
            baseURL: prefs.baseURL,
          })
        : undefined,
    );
    return snapshot();
  });

  ipcHandle('ax:testJevDecisionApi', async (_event, raw: unknown) => {
    const current = await snapshot();
    const prefs = normalizePrefs({
      enabled: current.enabled,
      model: current.model,
      baseURL: current.baseURL,
      ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as JevDecisionPrefs : {}),
    });
    const draft = prefs.apiKey?.trim();
    const secret = draft || await getJevSecret();
    if (!secret) throw new Error('Jev API 키가 없습니다.');

    const engine = new JevDecisionEngine({
      apiKey: secret,
      model: prefs.model,
      baseURL: prefs.baseURL,
    });
    const result = await engine.evaluate({
      state: { purpose: 'AX Studio Jev connection check' },
      questions: {
        reachable: {
          type: 'boolean',
          instructions: 'Return a probability for whether this is a connection check request.',
        },
      },
    });

    if (draft) {
      await setJevSecret(draft);
      if (current.enabled) getCore().refreshDecisionEngine(engine);
    }
    return {
      ok: true,
      model: result.model ?? prefs.model,
      masked: maskSecret(secret),
      saved: Boolean(draft),
    };
  });
}

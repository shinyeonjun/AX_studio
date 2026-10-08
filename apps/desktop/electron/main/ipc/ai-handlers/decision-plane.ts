import { JEV_DEFAULT_BASE_URL, JEV_PINNED_MODEL, JevDecisionEngine, JevDecisionError, resolveJevModel, validateJevApiKey } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import {
  getJevSecret,
  readAiToml,
  saveJevDecisionPreferences,
  setJevSecret,
} from '../../ai/config-file.js';
import { maskSecret } from '../../env-file.js';
import type { JevDecisionTomlConfig } from '../../ai/config-file/contracts.js';

const DEFAULT_JEV_MODEL = JEV_PINNED_MODEL;

interface JevDecisionPrefs {
  enabled?: boolean;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

const SETTINGS_UNREADABLE = '판단 엔진(Jev) 설정을 읽지 못했어요. 화면을 새로고침한 뒤 다시 저장해 주세요.';
const MALFORMED_KEY = 'API 키 형식이 올바르지 않아요. 띄어쓰기나 줄바꿈 없이 발급받은 그대로 붙여 넣어 주세요.';

function normalizedUrl(value: string | undefined): string {
  const candidate = value?.trim() || JEV_DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`판단 엔진(Jev) 서버 주소 형식이 올바르지 않아요. 예: ${JEV_DEFAULT_BASE_URL}`);
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('판단 엔진(Jev) 서버 주소는 https:// 로 시작해야 해요. http:// 는 내 컴퓨터 주소(localhost)에서만 쓸 수 있어요.');
  }
  return candidate.replace(/\/+$/, '');
}

function normalizePrefs(raw: unknown): Required<Pick<JevDecisionPrefs, 'enabled' | 'model' | 'baseURL'>> & Pick<JevDecisionPrefs, 'apiKey'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(SETTINGS_UNREADABLE);
  }
  const prefs = raw as JevDecisionPrefs;
  if (prefs.enabled !== undefined && typeof prefs.enabled !== 'boolean') {
    throw new Error(SETTINGS_UNREADABLE);
  }
  if (prefs.model !== undefined && typeof prefs.model !== 'string') {
    throw new Error(SETTINGS_UNREADABLE);
  }
  if (prefs.baseURL !== undefined && typeof prefs.baseURL !== 'string') {
    throw new Error(SETTINGS_UNREADABLE);
  }
  if (prefs.apiKey !== undefined && typeof prefs.apiKey !== 'string') {
    throw new Error(SETTINGS_UNREADABLE);
  }
  if (prefs.apiKey !== undefined && prefs.apiKey !== '') {
    try {
      validateJevApiKey(prefs.apiKey);
    } catch (cause) {
      throw new Error(MALFORMED_KEY, { cause });
    }
  }
  return {
    enabled: prefs.enabled ?? false,
    model: resolveJevModel(prefs.model) || DEFAULT_JEV_MODEL,
    baseURL: normalizedUrl(prefs.baseURL),
    ...(prefs.apiKey === undefined ? {} : { apiKey: prefs.apiKey }),
  };
}

function originOf(baseURL: string): string {
  return new URL(baseURL).origin;
}

/** Keys saved before origin binding are bound to the Base URL they were last saved with. */
function storedKeyOrigin(jev: JevDecisionTomlConfig | undefined): string {
  return jev?.keyOrigin || originOf(jev?.baseURL?.trim() || JEV_DEFAULT_BASE_URL);
}

const KEY_ORIGIN_MISMATCH =
  '판단 엔진(Jev) 서버 주소가 API 키를 등록할 때와 달라요. 새 주소에서 쓰려면 API 키를 다시 입력해 주세요.';

async function snapshot() {
  const config = await readAiToml();
  const jev = config.decision?.jev;
  const secret = await getJevSecret();
  return {
    enabled: jev?.enabled ?? false,
    model: resolveJevModel(jev?.model) || DEFAULT_JEV_MODEL,
    baseURL: jev?.baseURL?.trim() || JEV_DEFAULT_BASE_URL,
    defaultBaseURL: JEV_DEFAULT_BASE_URL,
    apiKeyConfigured: Boolean(secret),
    apiKeyMasked: secret ? maskSecret(secret) : undefined,
  };
}

export function registerDecisionPlaneHandlers(): void {
  ipcHandle('ax:getJevDecisionConfig', async () => snapshot());

  ipcHandle('ax:saveJevDecisionConfig', async (_event, raw: unknown) => {
    const prefs = normalizePrefs(raw);
    const origin = originOf(prefs.baseURL);
    let secret = prefs.apiKey || '';
    if (!secret) {
      const [config, stored] = await Promise.all([readAiToml(), getJevSecret()]);
      // A stored key never follows the Base URL to a new origin without being re-entered.
      if (stored && storedKeyOrigin(config.decision?.jev) !== origin) throw new Error(KEY_ORIGIN_MISMATCH);
      secret = stored;
    }
    if (prefs.enabled && !secret) {
      throw new Error('판단 엔진(Jev)을 쓰려면 API 키를 먼저 입력해 주세요.');
    }
    if (prefs.apiKey) await setJevSecret(prefs.apiKey);

    await saveJevDecisionPreferences({
      enabled: prefs.enabled,
      model: prefs.model,
      baseURL: prefs.baseURL,
      ...(secret ? { keyOrigin: origin } : {}),
    });

    getCore().refreshDecisionEngine(
      prefs.enabled
        ? new JevDecisionEngine({
            apiKey: secret,
            model: resolveJevModel(prefs.model),
            baseURL: prefs.baseURL,
          })
        : undefined,
    );
    return snapshot();
  });

  ipcHandle('ax:testJevDecisionApi', async (_event, raw: unknown) => {
    // Reject malformed draft credentials before reading stored configuration or constructing a request.
    normalizePrefs(raw ?? {});
    const current = await snapshot();
    const prefs = normalizePrefs({
      enabled: current.enabled,
      model: current.model,
      baseURL: current.baseURL,
      ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as JevDecisionPrefs : {}),
    });
    const draft = prefs.apiKey || undefined;
    let secret = draft;
    if (!secret) {
      const config = await readAiToml();
      secret = await getJevSecret();
      if (secret && storedKeyOrigin(config.decision?.jev) !== originOf(prefs.baseURL)) {
        throw new Error(KEY_ORIGIN_MISMATCH);
      }
    }
    if (!secret) throw new Error('판단 엔진(Jev) API 키를 먼저 입력해 주세요.');

    const engine = new JevDecisionEngine({
      apiKey: secret,
      model: resolveJevModel(prefs.model),
      baseURL: prefs.baseURL,
    });
    let result;
    try {
      result = await engine.evaluate({
        state: { purpose: 'AX Studio Jev connection check' },
        questions: {
          reachable: {
            type: 'boolean',
            instructions: 'Return a probability for whether this is a connection check request.',
          },
        },
      });
    } catch (error) {
      if (error instanceof JevDecisionError && (
        error.message.startsWith('TypeSafe API keys must be')
        || error.message.startsWith('TypeSafe request headers are invalid.')
      )) {
        throw new Error(MALFORMED_KEY, { cause: error });
      }
      if (error instanceof JevDecisionError && (error.status === 401 || error.status === 403)) {
        throw new Error('API 키가 거부됐어요. 키를 다시 확인해 주세요.', { cause: error });
      }
      if (error instanceof JevDecisionError && error.status !== undefined) {
        throw new Error(`판단 엔진(Jev) 서버가 연결 확인을 거절했어요(오류 ${error.status}). 서버 주소와 API 키 권한을 확인해 주세요.`, { cause: error });
      }
      throw new Error('서버에 연결할 수 없어요. 인터넷 연결과 서버 주소를 확인해 주세요.', { cause: error });
    }

    if (draft) {
      await setJevSecret(draft);
      // The saved key is bound to the origin it was just verified against.
      await saveJevDecisionPreferences({ baseURL: prefs.baseURL, keyOrigin: originOf(prefs.baseURL) });
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

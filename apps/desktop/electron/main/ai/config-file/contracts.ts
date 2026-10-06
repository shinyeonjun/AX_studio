import type { AiBrand, AiConnectionMode } from '@ax-studio/core';

interface AiBrandTomlConfig {
  mode?: AiConnectionMode;
  model?: string;
}

export interface JevDecisionTomlConfig {
  enabled?: boolean;
  model?: string;
  baseURL?: string;
  /** Origin the stored API key was entered for; the key is never sent anywhere else. */
  keyOrigin?: string;
}

export interface AiTomlConfig {
  active?: {
    brand: AiBrand;
    mode: AiConnectionMode;
    model: string;
  };
  providers: Partial<Record<AiBrand, AiBrandTomlConfig>>;
  decision?: {
    jev?: JevDecisionTomlConfig;
  };
  /** 레거시 [secrets] 파싱용. 저장하지 않음. */
  secrets: Record<string, string>;
}

export const BRAND_ENV_KEYS: Record<AiBrand, string> = {
  claude: 'ANTHROPIC_API_KEY',
  gpt: 'OPENAI_API_KEY',
  ollama: 'OLLAMA_API_KEY',
};

export const JEV_API_ENV_KEY = 'TYPESAFE_API_KEY';

import type { AiBrand, AiConnectionMode } from '@ax-studio/core';

export interface AiBrandTomlConfig {
  mode?: AiConnectionMode;
  model?: string;
}

export interface AiTomlConfig {
  active?: {
    brand: AiBrand;
    mode: AiConnectionMode;
    model: string;
  };
  providers: Partial<Record<AiBrand, AiBrandTomlConfig>>;
  /** 레거시 [secrets] 파싱용. 저장하지 않음. */
  secrets: Record<string, string>;
}

export const BRAND_ENV_KEYS: Record<AiBrand, string> = {
  claude: 'ANTHROPIC_API_KEY',
  gpt: 'OPENAI_API_KEY',
  grok: 'CURSOR_API_KEY',
  ollama: 'OLLAMA_API_KEY',
};

export const GROK_API_ENV_KEY = 'XAI_API_KEY';

import type { AiBrand } from '@ax-studio/core';

interface AiBrandTomlConfig {
  model?: string;
}

export interface JevDecisionTomlConfig {
  enabled?: boolean;
  model?: string;
  baseURL?: string;
  /** Origin the stored API key was entered for; the key is never sent anywhere else. */
  keyOrigin?: string;
  /**
   * The masked key (as settings shows it) that last passed the connection check at keyOrigin, so
   * the check is not asked for again at every start. Blank once a different key is saved.
   */
  verifiedKey?: string;
}

export interface AiTomlConfig {
  active?: {
    brand: AiBrand;
    model: string;
    /** `mode = "api"` from a build that still had API mode; read only to move the model to the CLI. */
    legacyMode?: string;
  };
  providers: Partial<Record<AiBrand, AiBrandTomlConfig>>;
  decision?: {
    jev?: JevDecisionTomlConfig;
  };
  /** 레거시 [secrets] 파싱용. 저장하지 않음. */
  secrets: Record<string, string>;
}

/** API keys saved by builds that still had API mode; removed from the OS store at start. */
export const RETIRED_AI_API_ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OLLAMA_API_KEY'] as const;

export const JEV_API_ENV_KEY = 'TYPESAFE_API_KEY';

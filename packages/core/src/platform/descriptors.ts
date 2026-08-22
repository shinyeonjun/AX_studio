import type { SideEffectLevel } from '../workflow/schema.js';

/** Catalog-facing tool descriptor. Runtime capabilities map to these at ingest time. */
export interface ToolDescriptor {
  id: string;
  label: string;
  description: string;
  connector?: string;
  sideEffect: SideEffectLevel;
  /** plain_chat | authoring | runtime_only */
  surfaces: Array<'plain_chat' | 'authoring' | 'runtime_only'>;
}

export interface ConnectionDescriptor {
  connector: string;
  label: string;
  connected: boolean;
}

export interface TriggerDescriptor {
  id: string;
  connector: string;
  label: string;
  description?: string;
}

export interface SkillDescriptor {
  id: string;
  role: string;
  description: string;
}

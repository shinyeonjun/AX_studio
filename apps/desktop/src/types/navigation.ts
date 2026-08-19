export type Tab = 'work' | 'approval' | 'activity' | 'settings';

export type WorkView = 'list' | 'conversation';

export type WorkFilter = 'all' | 'running' | 'paused' | 'once' | 'recurring';

export type SettingsScreen =
  | 'hub'
  | 'ai-claude'
  | 'ai-gpt'
  | 'slack'
  | 'gmail'
  | 'local-folder';

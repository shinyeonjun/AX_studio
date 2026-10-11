import type { AppDatabase } from '../db.js';
import * as settingsRepo from '../repositories/settings-repository.js';
import { ChatHostStateMap } from '../chat-host-state.js';
import { mergeColumnLabels, validColumnLabel, type ColumnLabels } from '../../contracts/artifacts/column-labels.js';
import { mergeSourceChoices, validSourceChoice, type SourceChoice } from '../../contracts/source-choices.js';

const COLUMN_LABELS_SETTING = 'column_labels';
const UNLABELLED_COLUMNS_SETTING = 'column_labels_unlabelled';
const MAX_UNLABELLED_COLUMNS = 2_000;
const SOURCE_CHOICES_SETTING = 'source_choices';

export class SettingsStore {
  // Invalidates derived catalogs without hashing large persisted connector configs.
  private connectionRevision = 0;
  constructor(private readonly db: AppDatabase) {}

  /** Host-only state of one kind, per conversation, that survives a restart. */
  chatHostState<T>(kind: string, maxEntries?: number): ChatHostStateMap<T> {
    return new ChatHostStateMap<T>(this.db, kind, maxEntries);
  }
  getSetting<T>(key: string, defaultValue: T): T { return settingsRepo.getSetting(this.db, key, defaultValue); }
  listSettingsByPrefix(prefix: string) { return settingsRepo.listSettingsByPrefix(this.db, prefix); }
  getGlobalActive(): boolean { return settingsRepo.getGlobalActive(this.db); }
  setSetting(key: string, value: unknown) { settingsRepo.setSetting(this.db, key, value); }
  deleteSetting(key: string) { settingsRepo.deleteSetting(this.db, key); }
  /** Korean headers learned for column names, shared by chat answers and run results. */
  getColumnLabels(): ColumnLabels {
    const stored = settingsRepo.getSetting<unknown>(this.db, COLUMN_LABELS_SETTING, {});
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => validColumnLabel(entry[1])));
  }
  /** Places the person picked when a request fitted several; background for later routing. */
  getSourceChoices(): SourceChoice[] {
    const stored = settingsRepo.getSetting<unknown>(this.db, SOURCE_CHOICES_SETTING, []);
    return Array.isArray(stored) ? stored.filter(validSourceChoice) : [];
  }
  rememberSourceChoice(choice: SourceChoice) {
    if (!validSourceChoice(choice)) return;
    settingsRepo.setSetting(this.db, SOURCE_CHOICES_SETTING, mergeSourceChoices(this.getSourceChoices(), choice));
  }
  /** Column names the AI was asked to label and could not; they are not asked about again. */
  getUnlabelledColumns(): string[] {
    const stored = settingsRepo.getSetting<unknown>(this.db, UNLABELLED_COLUMNS_SETTING, []);
    return Array.isArray(stored) ? stored.filter((name): name is string => typeof name === 'string') : [];
  }
  rememberColumnLabels(labels: ColumnLabels, unlabelled: readonly string[] = []) {
    if (Object.keys(labels).length > 0) {
      settingsRepo.setSetting(this.db, COLUMN_LABELS_SETTING, mergeColumnLabels(this.getColumnLabels(), labels));
    }
    if (unlabelled.length > 0) {
      const names = [...new Set([...this.getUnlabelledColumns(), ...unlabelled])].slice(-MAX_UNLABELLED_COLUMNS);
      settingsRepo.setSetting(this.db, UNLABELLED_COLUMNS_SETTING, names);
    }
  }
  setConnection(connector: string, connected: boolean, config?: Record<string, unknown>) {
    settingsRepo.setConnection(this.db, connector, connected, config);
    this.connectionRevision++;
  }
  getConnectionRevision() { return this.connectionRevision; }
  getConnections(options?: { suppressCorruptDiagnostics?: boolean }) { return settingsRepo.getConnections(this.db, options); }
}

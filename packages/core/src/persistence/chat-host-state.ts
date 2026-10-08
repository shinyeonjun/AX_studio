import type { AppDatabase } from './db.js';
import * as repo from './repositories/chat-host-state-repository.js';

/**
 * One kind of host-only conversation state, keyed by chat id, kept in the database so it outlives
 * the process: a job draft whose card is still in the chat works after the app restarts.
 * Shaped like the Map it replaces. A value that no longer parses reads as absent and is dropped.
 * Setting a new chat beyond `maxEntries` drops the oldest one instead of refusing.
 */
export class ChatHostStateMap<T> implements Iterable<[string, T]> {
  constructor(
    private readonly db: AppDatabase,
    private readonly kind: string,
    private readonly maxEntries = Number.POSITIVE_INFINITY,
  ) {}

  get(chatId: string): T | undefined {
    const json = repo.getChatHostState(this.db, chatId, this.kind);
    if (json === undefined) return undefined;
    try {
      return JSON.parse(json) as T;
    } catch {
      repo.deleteChatHostState(this.db, chatId, this.kind);
      return undefined;
    }
  }

  has(chatId: string): boolean {
    return this.get(chatId) !== undefined;
  }

  set(chatId: string, value: T): this {
    repo.setChatHostState(this.db, chatId, this.kind, JSON.stringify(value));
    if (Number.isFinite(this.maxEntries)) repo.trimChatHostState(this.db, this.kind, this.maxEntries);
    return this;
  }

  delete(chatId: string): boolean {
    const existed = repo.getChatHostState(this.db, chatId, this.kind) !== undefined;
    repo.deleteChatHostState(this.db, chatId, this.kind);
    return existed;
  }

  get size(): number {
    return repo.countChatHostState(this.db, this.kind);
  }

  *[Symbol.iterator](): IterableIterator<[string, T]> {
    for (const { chatId } of repo.listChatHostState(this.db, this.kind)) {
      const value = this.get(chatId);
      if (value !== undefined) yield [chatId, value];
    }
  }
}

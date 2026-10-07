import type { SourceListingConnection } from '../../../connectors/types.js';
import { MAX_DECISION_CHOICE_CRITERIA } from '../../../contracts/decision.js';
import { addHttpOperations, addOpenApiOperations } from './http-operations.js';
import { operationQueryTokens, type IndexedReadOperation } from './indexed-operation.js';
import { addLocalFolderOperations } from './local-folder-operations.js';
import { addGmailOperations, addSlackOperations } from './messaging-operations.js';
import { addRdbOperations } from './rdb-operations.js';
import type { HintResolution, JevReadOperationHint, JevReadOperationSelection } from './types.js';

// Reserve one provider choice for `none` so each operation question stays valid.
const JEV_READ_OPERATION_MAX_CHOICES = MAX_DECISION_CHOICE_CRITERIA - 1;

/**
 * Uses lexical relevance only to order oversized catalogs. Jev still receives
 * every eligible operation and makes the semantic selection.
 */
export function selectJevReadOperationHints(
  hints: readonly JevReadOperationHint[],
  userMessage: string,
): readonly JevReadOperationHint[] {
  if (hints.length <= JEV_READ_OPERATION_MAX_CHOICES) return hints;

  const tokens = operationQueryTokens(userMessage);
  if (tokens.length === 0) return hints;
  return hints
    .map((hint, index) => {
      const text = [hint.sourceLabel, hint.label, hint.description, hint.capabilityId]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      const score = tokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0);
      return { hint, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.hint);
}

export class JevReadOperationIndex {
  private readonly operations: readonly IndexedReadOperation[];
  private readonly termIndex: ReadonlyMap<string, readonly number[]>;

  constructor(connections: readonly SourceListingConnection[]) {
    const operations: IndexedReadOperation[] = [];
    for (const connection of connections) {
      if (!connection.connected) continue;
      if (connection.connector === 'http') addHttpOperations(operations, connection);
      if (connection.connector === 'openapi') addOpenApiOperations(operations, connection);
      if (connection.connector === 'rdb') addRdbOperations(operations, connection);
      if (connection.connector === 'gmail') addGmailOperations(operations);
      if (connection.connector === 'slack') addSlackOperations(operations);
      if (connection.connector === 'local_folder') addLocalFolderOperations(operations, connection);
    }
    this.operations = operations;

    const termIndex = new Map<string, number[]>();
    for (const [index, operation] of operations.entries()) {
      for (const term of operation.searchTerms) {
        const postings = termIndex.get(term);
        if (postings) postings.push(index);
        else termIndex.set(term, [index]);
      }
    }
    this.termIndex = termIndex;
  }

  select(userMessage: string): JevReadOperationSelection {
    const scores = new Map<number, number>();
    for (const term of new Set(operationQueryTokens(userMessage))) {
      for (const index of this.termIndex.get(term) ?? []) {
        scores.set(index, (scores.get(index) ?? 0) + 1);
      }
    }
    let lexicalTopScore = 0;
    for (const score of scores.values()) lexicalTopScore = Math.max(lexicalTopScore, score);
    let mode: JevReadOperationSelection['mode'];
    let selected: readonly IndexedReadOperation[];
    if (this.operations.length === 0) {
      mode = 'empty_catalog';
      selected = [];
    } else if (this.operations.length <= JEV_READ_OPERATION_MAX_CHOICES) {
      // When the provider can accept the whole catalog, keep semantic ranking with Jev.
      mode = 'full_catalog';
      selected = this.operations;
    } else if (scores.size > 0) {
      mode = 'lexical_relevance';
      selected = this.operations
        .map((operation, index) => ({ operation, score: scores.get(index) ?? 0, index }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ operation }) => operation);
    } else {
      // Jev allows 255 choices, including `none`; the router chunks this full
      // metadata catalog into provider-sized choice questions.
      mode = 'no_lexical_match';
      selected = this.operations;
    }

    const hints = selected
      .map((operation) => {
        const resolution = operation.resolve(userMessage);
        return resolution ? { ...operation, ...resolution } : undefined;
      })
      .filter((hint): hint is IndexedReadOperation & HintResolution => hint !== undefined)
      .map(({ resolve: _resolve, searchTerms: _searchTerms, ...hint }) => hint);

    return {
      hints,
      totalCount: this.operations.length,
      catalogMayBeBounded: hints.length < this.operations.length,
      mode,
      lexicalMatchedOperationCount: scores.size,
      lexicalTopScore,
    };
  }
}

export function buildJevReadOperationIndex(
  connections: readonly SourceListingConnection[],
): JevReadOperationIndex {
  return new JevReadOperationIndex(connections);
}

/**
 * Builds a query-specific local catalog for Jev route selection.
 *
 * This is deliberately metadata-only: it parses persisted schemas and never
 * probes a network, opens a database, or includes credentials in the result.
 */
export function buildJevReadOperationHints(
  connections: readonly SourceListingConnection[],
  userMessage: string,
): JevReadOperationHint[] {
  return buildJevReadOperationIndex(connections).select(userMessage).hints;
}

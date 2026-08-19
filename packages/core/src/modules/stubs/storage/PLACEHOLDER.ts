/**
 * Workflow-local key/value storage (builtin).
 *
 * Planned capabilities:
 *   - storage.get
 *   - storage.set
 *
 * Not trigger cursors (see gmail/new-message-poll seenMessageIds).
 * Persists per workflowId in SQLite settings or dedicated table.
 *
 * Priority: top 5 additions with PDF Read, Calendar, Sheets, Formatter.
 *
 * @see ../../nodes/README.md
 */
export {};

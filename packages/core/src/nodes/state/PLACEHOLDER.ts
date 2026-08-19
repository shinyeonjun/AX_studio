/**
 * Workflow-local state (separate from trigger poll cursors).
 *
 * Planned capabilities:
 *   - storage.get
 *   - storage.set
 *
 * Use cases: last processed order id, dedupe notified emails, week-over-week compare.
 *
 * Implementation candidate: connectors/storage/ (builtin, no OAuth).
 *
 * @see ../README.md
 */
export {};

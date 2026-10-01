# AX bounded database read contract

Design proposal for source baseline 4071ce0. This is a patch plan, not implemented support.

## Minimal correctness patch before scale work

### Patch 1 Make coverage and consistency explicit

Extend the RDB read result with a host-owned `readScope` and `coverage` envelope while keeping existing TableArtifact fields for compatibility. Suggested fields are `scopeKind` (page, whole_query, aggregate), normalized filter/projection identity, `queryFingerprint`, `schemaVersion`, `permissionScopeVersion`, `readSessionId`, `snapshotMode` (verified_snapshot, immutable_source, live, unverified), `inputCoverage` (complete, partial, unknown), `outputCoverage`, `observedRows`, `hasMore`, and an opaque continuation cursor.

Only the executor may assert whole-query input coverage. An offset greater than zero and no more rows can establish the last page's completion but not that its caller captured the preceding rows. A model field cannot turn a preview into a privileged full read. Capture exhaustion with unverified consistency must remain distinct from exact snapshot completion. Preserve the requested period in provenance but do not claim it was physically applied unless a typed filter was executed.

Target seams: `connectors/rdb/connector.ts`, `contracts/artifacts/table.ts` / completeness envelope, `documents/reporting/source/schema.ts`, `source/capture.ts`, `plan/execute.ts`, and runtime result consumers. Gate exact whole-source calculations on suitable coverage. Do not silently relabel a sample or a live multi-page read as exact.

Tests: a final page cannot authorize a whole-table aggregate; snapshots with unknown/live consistency either meet a explicitly reviewed task policy or fail closed; legitimate zero results succeed; row/byte/time exhaustion cannot produce exact output; caller-supplied capture privilege is denied.

### Patch 2 Use stable traversal and a retained read session

Introduce a host-owned `RdbReadSession` that owns a connection, read-only transaction, cancellation, deadlines and cleanup. Resolve all table identifiers to catalog-owned fully qualified references. For row traversal, discover and validate a declared unique non-null key or a verified unique ordering tuple. Compile an ORDER BY and keyset predicate from that tuple; use the dialect's corresponding comparisons. For nullable or mixed-direction keys, implement and test explicit semantics rather than borrowing a naive tuple comparison.

The continuation cursor is opaque and bound to query, order, connection, permissions, schema and session/snapshot. Reject cursors reused for different scopes. Advance by ordering identity, not by content hash. Verify monotone key progress and fetch at most a bounded batch plus one continuation sentinel. Equal payloads with different keys are legitimate rows. If no trustworthy key exists, use a supported single-session server cursor or a bounded immutable snapshot/spool; otherwise stop with a specific unsupported/consistency reason. Do not guess that a sampled column is unique.

For current OFFSET callers, keep a small explicitly non-snapshot preview path if needed. Do not claim that adding ORDER BY alone fixes concurrent changes, or that keyset alone supplies a snapshot. Reconnection cannot transparently resume a destroyed transaction; restart the whole-query operation or resume from a previously complete immutable host snapshot under a new run identity.

Target seams: `client/types.ts`, `drivers.ts`, `rows.ts`, `describe.ts`, `connector.ts`, and `reporting/source/capture.ts`. Treat SQLite keys, PostgreSQL relation metadata, and MySQL/InnoDB keys as dialect-specific capabilities. Keyless legitimate duplicates and nonidentical overlaps become mandatory regression fixtures.

### Patch 3 Preserve DB scalar types and precision

Introduce a DB intake policy that preserves identifier/text strings, date-only values, exact integral/decimal strings and provenance. Separate presentation values from calculation values. Avoid silently converting BIGINT, NUMERIC/DECIMAL and numeric-looking identifiers to JavaScript Number. A minimal interim safety patch may reject exact calculations when typed values would exceed the supported safe numeric range; this is safer than returning a rounded result.

If the existing raw-value sidecar is reused, add it explicitly for the DB intake and make report capture consume that typed/raw representation. Changing the artifact builder alone is insufficient because current capture copies `row.values`. Keep XLSX compatibility work independent and do not change the evaluator's entire legacy numeric policy incidentally.

Tests: identifiers `001`, whitespace-bearing text, BIGINT at and beyond 2^53, positive/negative decimal scales, currency units, null, malformed numeric text, DATE and timestamp timezone semantics, joins on exact keys, and output JSON serialization. Exact-decimal arithmetic and rounding policy require an explicit versioned contract.

### Patch 4 Enforce request and execution boundaries

Use strict versioned schemas. Reject unsupported filter/projection/aggregate fields instead of silently ignoring them. Never add a model-provided raw SQL field. Whitelist operators, aggregates and functions; resolve identifiers from authorized catalog IDs and dialect-quote them; bind all literal values. Disallow arbitrary UDFs, stored procedure calls, locking clauses, DML CTEs, SELECT INTO, OUTFILE/LOAD/file operations and unreviewed views/functions.

Keep a least-privilege reader account and host-selected read-only transaction access mode. This hardens, rather than replaces, existing allowlists and fixed SQL. Scope MySQL snapshot guarantees to supported transactional engines. Abort must clean up or destroy the session and release all resources. SQLite blocking work must execute in a cancellable isolation boundary with a supported native interrupt/progress hook or a dedicated process deadline; pre-call AbortSignal checks alone are insufficient.

Add per-query server budget where supported, host operation deadline, page/batch size, total row/byte budgets, per-field limits, pending-buffer limits, aggregate-state/group caps, disk quota and per-connection concurrency. Return specific typed failure reasons rather than a generic RDB error for every denial, timeout, snapshot loss and unsupported operation. Do not increase the present caps as a substitute for these controls.

## Large data execution after correctness

### Metadata first

Search only the authorized object catalog. Read physical schema, precise types, PK/unique/FK/index metadata, view/table identity and optional DB-provided comments for selected objects. Keep business meaning separate: purpose, grain, units, currency, timezone, status/date definitions, period ownership and source freshness need verified definitions or a user clarification. Store whether each fact was declared, supplied, observed or inferred. No hidden benchmark rules may become domain knowledge.

Use bounded samples only to inspect values and ambiguity. Samples are not full counts, sums, uniqueness proofs or evidence that rare states do not exist. Estimated table sizes and planner statistics are approximate and sometimes stale. Avoid automatic full-table COUNT/MIN/MAX/profiling during discovery. PostgreSQL notes that planner counts/statistics are estimates and a full exact COUNT can require whole-table/index work. MySQL InnoDB table row estimates are also approximate. [PostgreSQL planner statistics](https://www.postgresql.org/docs/current/planner-stats.html), [PostgreSQL aggregate costs](https://www.postgresql.org/docs/current/functions-aggregate.html), [MySQL table metadata](https://dev.mysql.com/doc/refman/8.4/en/information-schema-tables-table.html)

Metadata keyword search, exact IDs/names, comments and business aliases should come before vector infrastructure. Semantic search may improve measured source recall, but it is optional and not a prerequisite for executing exact relational queries. A relevance-ranked set of retrieved records is not an exhaustive population.

### Typed plan and dialect compiler

Jev proposes intent, source/field IDs, filters, relation/metric references, aggregate operations and output bindings in typed IR. The host validates and compiles that plan. Jev does not gain direct SQL, shell, database credentials or production schema access.

Start with a deliberately small same-database, single-table subset: explicit projection, well-typed compare/IN/null predicates, a declared half-open time range, COUNT rows, compatible numeric SUM/MIN/MAX/AVG and bounded GROUP BY. Database aggregation keeps matching input rows in the DB and returns only bounded aggregate output plus proof metadata. An aggregate can be exact over 10 million input rows even if its output has ten rows; this does not mean the input scan is cheap.

Output LIMIT applies after aggregation and can truncate the group domain. Encode output coverage independently from input coverage. A complete sum over requested data and a truncated list of groups are different claims. Values, filters and semantics must be tied to the executed plan, not merely to a natural-language label or requestedPeriod field.

Initially push down only operations with differential tests proving agreement with the selected semantic version. For null/coercion/empty behavior, either emit equivalent SQL guards and expressions or decline lowering. Do not pretend that COUNT(field) equals COUNT rows, that native COUNT DISTINCT has AX's null handling, that SUM DISTINCT(value) implements keyed sum_distinct, or that DB collation/numeric conversion equals JavaScript comparable().

### Join correctness

Add joins only after key metadata, relation scope and grain are understood. All joined sources must belong to authorized query scope. A declared FK is evidence of a physical relationship, not by itself a definition of the business metric. Validate uniqueness/cardinality on the requested snapshot or rely on suitable declared constraints; record whether the proof is structural or observed. A sampled unique value is insufficient.

Prevent one-to-many fan-out from multiplying a parent-grain measure. Preaggregate child-grain data or use existence/semi-join logic when the task demands it. Enforce nullable-key, left-join, unmatched-row and duplicate/conflicting-value semantics. Bound expected and actual join expansion and group cardinality. Many-to-many joins require an explicit metric definition and budget; they cannot be made correct merely by adding DISTINCT.

Cross-database and HTTP-to-DB joins are not a free extension of same-DB pushdown. Require a separately supported bounded local join/spool strategy and truthful cross-source temporal consistency. Do not pull ten million rows locally just because the IR mentions a join.

### Estimated plans and database optimization

Use bounded host-generated EXPLAIN on the already validated query when supported. PostgreSQL can provide FORMAT JSON without ANALYZE; MySQL has its own JSON/TREE behavior and version constraints. SQLite EXPLAIN QUERY PLAN is useful diagnostic evidence but its output format is unstable, so use versioned adapters and do not depend on an exact text layout for safety.

Estimated scans, sort/spill risk, join expansion, available indexes and output shape can cause the host to narrow the query, route to an approved reporting view/read replica, warn or decline under the operation budget. Do not compare raw cost numbers across dialects as elapsed milliseconds, treat optimizer estimates as exact row counts, or forbid every full scan. An exact whole-period aggregate sometimes legitimately scans all matching input; the deadline and resource policy remain necessary.

EXPLAIN ANALYZE runs the statement. It requires separate deliberate benchmarking against an approved test/staging scope; it should not run automatically merely to decide whether a production query is affordable. Production CREATE INDEX, ANALYZE/statistics changes, materialized views, schema migrations, grants and configuration edits belong to a reviewed DBA/deployment action. The default read path can recommend them with evidence but does not execute them.

### Streaming and snapshots by dialect

- PostgreSQL: retain a READ ONLY transaction at a selected isolation level; use a driver-supported bounded cursor or keyset execution. REPEATABLE READ pins statement visibility within the transaction. Set statement and lock timeouts locally, enforce an overall host deadline, and bound transaction lifetime. Long snapshots can delay cleanup of dead tuples; do not hold one open while waiting for model turns. Exported snapshots are an optional later mechanism with explicit lifecycle constraints, not a restart token that works forever. [PostgreSQL transaction semantics](https://www.postgresql.org/docs/current/sql-set-transaction.html), [PostgreSQL cursor](https://www.postgresql.org/docs/current/sql-declare.html), [PostgreSQL timeouts](https://www.postgresql.org/docs/current/runtime-config-client.html)
- MySQL: qualify supported server version/engine, use READ ONLY and appropriate InnoDB consistent-read transaction semantics, and keep the same connection. The current 30-second driver timer should not be described as a proven server execution cap. A host-generated MAX_EXECUTION_TIME hint can bound eligible read-only SELECTs on supported MySQL servers; it is not universal for stored programs, MariaDB or every operation. Confirm cancellation and cleanup in integration tests. [MySQL transaction modes](https://dev.mysql.com/doc/refman/8.4/en/set-transaction.html), [InnoDB consistent reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html), [MySQL execution time hint](https://dev.mysql.com/doc/refman/8.4/en/optimizer-hints.html)
- SQLite: keep one readonly native connection and an explicit read transaction for a stable snapshot, respecting WAL/rollback-journal behavior and writer impact. Use bounded iteration/fetches and a supported interrupt mechanism in an isolated process or native binding. Refuse a large sql.js whole-file fallback rather than silently exhausting memory. Never set immutable mode unless the file truly cannot change, and never checkpoint or rewrite the user's database as part of read-only access. [SQLite isolation](https://sqlite.org/isolation.html), [SQLite interrupt](https://sqlite.org/c3ref/interrupt.html), [SQLite progress callbacks](https://sqlite.org/c3ref/progress_handler.html)

### Full scope semantic classification

If the task genuinely requires semantic classification of text rows, SQL numeric aggregation alone cannot decide the labels. First apply safe structural filtering/projection in the DB, then estimate the eligible population and processing cost. Deduplicate exact repeated text only when record-to-text mapping and metric weights are retained. Process bounded text batches with model input/output budgets, bounded parallelism, retries and checkpointed stable record identities. Keep model/prompt/schema versions with classifications.

Unknown or failed labels remain explicit, with processed/eligible/unknown/failed coverage counts. An exact category count requires every eligible record to be accounted for under the specified classification policy; a sample, embedding top-k or confidence threshold does not provide that. If all-record classification exceeds the budget, ask for narrower scope or supply a clearly labeled approximate/sample-based result only when appropriate. Do not send row text to a hosted model until the data boundary and authorization are satisfied.

## Acceptance gates and stop conditions

The correctness patch is accepted only when unsafe completion, legitimate duplicate rows and precision-loss regressions are converted into required correct behavior, and existing callers remain compatible or are explicitly migrated. Green characterization tests that expect the old defects do not meet this gate.

The first pushdown release is accepted only for an explicit operation/dialect/type matrix after compiler/evaluator differential tests, permission and injection tests, server cancellation/snapshot integration tests and bounded-resource tests pass. Promote unsupported operations by adding tests and declared capabilities, not by silently falling back to whole-table capture.

For an execution: finish when exact output for the approved query/snapshot is verified, or stop at a typed unresolved semantics/permission/unsupported/budget/snapshot-loss condition. A returned partial page, unchanged retry, cursor alone or small aggregate output is not completion. Preserve immutable evidence for replay without retaining unnecessary raw row data.

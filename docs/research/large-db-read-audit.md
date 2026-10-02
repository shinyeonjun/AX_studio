# AX database read audit

Research date: 1 October 2026. Public source baseline: [AX Studio 4071ce0](https://github.com/shinyeonjun/AX_studio/tree/4071ce0e82515f41d6763fc3ae8ba341a33f6555). The source was materialized from git into an immutable isolated archive before the final tests. No AX product source was changed by this work.

## Conclusion

AX should not assume that every user's database is already optimized. It should use the database's own optimizer, push compatible filtering and aggregation to the source, inspect authorized metadata and estimated plans, and stop or narrow a read when the available indexes and execution budget do not support the requested scope. Index creation and production schema changes are separate reviewed operations.

Million-row processing does not mean sending a million rows to the model. A report that asks for ten regional sums can return ten aggregate rows after the DB processes all matching records. Conversely, a LIMIT on returned rows does not cap the scan or guarantee cheap execution. Full-scope semantic classification is a different workload and requires a bounded batch pipeline and an explicit completeness contract.

The present AX read path does not provide that architecture. It reads whole table pages with SELECT star and OFFSET, without stable ordering; report capture stores every row in memory and normally stops at 100,000 rows or 32 MiB across sources. The synthetic tests demonstrate useful mechanisms and reproduce concrete current defects. They do not show that AX already supports 1 million or 10 million rows.

## Current capabilities and gaps

### Existing boundaries worth preserving

`packages/core/src/connectors/rdb/connector.ts:24–117` accepts fixed read actions, validates table references and table/schema allowlists before access, caps ordinary reads, uses one extra row to indicate continuation, and does not accept arbitrary SQL from the model. Passing a raw SQL field does not execute it. Empty table allowlists deny reads. PostgreSQL and MySQL values are bound parameters; SQL identifiers pass a conservative ASCII identifier check and are dialect-quoted. These are useful boundaries, not support for arbitrary query plans.

`connectors/rdb/client/describe.ts:13–82` implements paged physical column metadata and bounded DB-provided descriptions. PostgreSQL/MySQL return names, data types, nullability and comments. SQLite also reports primary-key position and declared NOT NULL. The older repository research note saying table metadata is unavailable is stale for this commit. Keys, foreign-key relationships, index shape, precise numeric type metadata, object comments and business semantics remain incomplete.

`connectors/rdb/client/drivers.ts:33–35` already configures PostgreSQL connection, server statement and driver query timeouts, with 10-second connect and 30-second query limits. MySQL execution passes a 30-second driver timeout at lines 70–73. Cancellation closes or destroys network clients. This is not the same as verifying server-side cancellation for every phase or enforcing an end-to-end multi-page deadline.

`documents/reporting/source/capture.ts:210–221` already fails closed on row/byte budget excess. `documents/reporting/plan/execute.ts:114–118` refuses a source marked incomplete; lines 145–153 enforce declared one-cardinality and a 100,000-row join expansion cap. These guards should not be removed just to permit larger tables.

### Priority 0 correctness risks

1. **Unstable and inconsistent traversal.** `connectors/rdb/client/rows.ts:34,43–46` emits SELECT star with LIMIT/OFFSET and no ORDER BY. Each call opens and closes its own connection. `documents/reporting/source/capture.ts:154–194` advances an offset based on returned length. A synthetic concurrent insert reproduced `[1,2,2,3,4,5]` being accepted as complete. The snapshot records `consistency: 'unverified'` at lines 233–237, but `complete: true` and `hasMore: false` do not establish one-time source coverage. PostgreSQL documents both the ordering requirement and the work still needed for skipped OFFSET rows. [PostgreSQL LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html)
2. **Legitimate duplicates are mistaken for no progress.** `capture.ts:181–184` rejects equal page-content hashes. Two distinct pages of a keyless table containing identical values are legitimate data. The 20,001-row synthetic table reproduced this false rejection. Progress must be checked by a host cursor/page identity and stable row identity, not solely by equal value arrays. Do not simply remove the hash guard while retaining unsafe OFFSET traversal.
3. **Numeric strings can silently lose precision.** `contracts/artifacts/table-build.ts:normalizeScalar` converts numeric-looking strings to JavaScript Number before RDB capture. The exact string `9007199254740993` becomes `9007199254740992`. `capture.ts:177` copies `row.values`, so an optional raw-value sidecar alone would not preserve report inputs. This also risks treating leading-zero identifiers as numbers. A DB-specific typed intake or an explicit fail-closed precision gate is needed before claiming exact financial totals or exact identifier joins.
4. **Page completion and source completion are conflated.** An interactive read starting at offset 2 returned one final row with `completeness.status: 'complete'`. That page is complete; the whole table was not read by that call. Preserve legacy fields if needed but add explicit result scope and input coverage so neither the model nor a calculation can infer whole-source totals from a last page.

### Priority 1 scale and execution gaps

1. **No predicate, projection, aggregation or join pushdown.** `readRdbRows` and `ReportRdbSourceSpec` accept table/offset/limit only. The report source schema at `documents/reporting/source/schema.ts:32–40,126–129` is alias plus table. The source capture request at `capture.ts:166–170` contains no period predicate. Both example-period and target-period capture fetch the same entire DB table, then the JavaScript evaluator filters/joins/aggregates captured rows. Supplying filter or projection parameters now is silently ignored, as the characterization test proves.
2. **Practical report caps are smaller than advertised page capacity.** `rows.ts:7–9` caps physical pages at 10,000 rows and offsets at 1,000,000. Report capture defaults to 100,000 rows / 32 MiB across all sources. The 1,000-page loop limit does not imply 10-million-row support because earlier budgets and the offset cap stop it.
3. **Buffers are bounded by rows, not complete resource budgets.** Drivers return arrays, SQLite `.all` is synchronous, and TableArtifact conversion creates matrices, normalized values and profiles. Wide text/BLOB rows can be expensive before the report byte limit is checked. Query duration, per-field/row size, total result bytes, in-flight batches, group/state cardinality, local disk and concurrent reads need independent budgets.
4. **SQLite fallback loads the entire file.** `persistence/db/sqljs.ts:285–299` reads the whole file into sql.js memory. Reopening it for each page is unsuitable for large databases. `persistence/db-native.ts:56–68` uses a real readonly native handle but exposes only synchronous `.all`; no streaming or in-flight interrupt is wired. `AbortSignal.throwIfAborted` before that call cannot itself interrupt a blocking SQLite query.
5. **Server-enforced read-only and retained snapshots are absent.** Network drivers do not set a read-only transaction or retain a read session across pages. Fixed SQL prevents model-supplied writes, but a least-privilege read role, reviewed views and DB transaction access mode are additional defenses. PostgreSQL read-only is a high-level restriction, not a promise of zero disk writes. MySQL consistency recommendations must be scoped to transactional InnoDB tables. [PostgreSQL SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html), [MySQL SET TRANSACTION](https://dev.mysql.com/doc/refman/8.4/en/set-transaction.html), [InnoDB consistent reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)
6. **No estimated-plan adapter.** No EXPLAIN path was found in the RDB connector. Plan inspection should be host-generated and bounded. EXPLAIN ANALYZE executes the statement and is not a safe automatic planning substitute. Estimated cost/rows are estimates, not elapsed-time guarantees. SQLite EXPLAIN QUERY PLAN output is explicitly not a stable application interface. [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html), [MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html), [SQLite EXPLAIN QUERY PLAN](https://sqlite.org/eqp.html)

### SQL lowering must preserve defined semantics

`documents/reporting/plan/aggregate.ts:24–73` and `plan/value.ts:40–129` are not transparent equivalents of ordinary SQL expressions. Empty SUM and AVG currently return 0; SUM over NULL throws; COUNT DISTINCT counts a null value; numeric-looking strings are coerced; a null equals null predicate can be true. A SQL compiler must either preserve these rules through explicit expressions and validation or introduce a reviewed versioned semantic contract. SQL generally ignores NULL in numeric aggregates and returns NULL for an empty SUM or AVG. [PostgreSQL aggregates](https://www.postgresql.org/docs/current/functions-aggregate.html), [MySQL aggregates](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html), [SQLite aggregates](https://sqlite.org/lang_aggfunc.html)

AX `sum_distinct` deduplicates by a separate entity key and rejects conflicting amounts for that key. SQL SUM DISTINCT amount deduplicates values, not entities, so it can be wrong even when the query is syntactically valid. The synthetic two-order fixture has a correct order-grain sum of 200; a naive item join returns 300; SUM DISTINCT amount returns 100; preaggregating item keys returns 200.

## Tests completed

### AX source tests

On the immutable baseline, 15 existing focused test files / 76 tests passed, and one new file / 10 characterization tests passed. Both sets passed on Node 24.19.0 and were successfully rerun on the repo-supported Node 22.23.2 with Vitest 5.0.1. Characterization assertions intentionally record present behavior, so a green result is evidence of reproduction rather than repair. Baseline results cover the RDB connector, metadata, policy, cancellation, report capture and join limits; they are not the full repository test suite.

The new file checks ignored filter/projection/SQL fields; offset cap; missing period pushdown; actual 100,001-row budget refusal; legitimate duplicate pages; nonidentical live page overlaps; byte-limit refusal; final-page scope; large integer precision loss; and pre-lowering semantic differences.

### Synthetic SQLite mechanisms

The deterministic fixture had four narrow integer columns and a unique INTEGER PRIMARY KEY. Results were checked against arithmetic oracles, not a second SQL query using the same formula. Every full keyset walk verified the next exact ID online and compared total count and sum.

| Input rows | Exact sum | DB file with synthetic index | Maximum fetched batch | Full keyset walk |
| ---: | ---: | ---: | ---: | ---: |
| 10,000 | 5,005,000 | 253,952 bytes | 4,096 | 5.9 ms |
| 100,000 | 50,050,000 | 2,613,248 bytes | 4,096 | 49.9 ms |
| 1,000,000 | 500,500,000 | 26,742,784 bytes | 4,096 | 443.8 ms |
| 10,000,000 | 5,005,000,000 | 279,248,896 bytes | 4,096 | 5,756.3 ms |

The 10-million-row stage completed in 37.4 seconds including generation, index construction, repeated queries and traversal; the Python process peak RSS was about 79,176 KiB. These are observations of this small synthetic workload in this container, not user latency targets, p95 numbers, cold-cache measurements or promises for remote DBs.

At 10 million rows, SUM with LIMIT 1 still produced approximately 30,000 callbacks at one callback per 1,000 SQLite VM operations. A sparse unindexed ten-row result also required about 30,000 callbacks; the indexed query was below a single callback interval. A near-tail OFFSET page used about 20,000 callbacks; its unique-key keyset equivalent was below one. These callbacks measure VM events, not exact scanned rows, I/O or PostgreSQL/MySQL cost. Raw plans and three per-query timings are retained.

The harness also verified legitimate zero rows, the join fan-out example, a progress-handler interruption followed by successful connection reuse, and a readonly retained SQLite snapshot during a writer mutation. Outside that transaction, a subsequent keyset read saw the mutation. The interruption test used Python's SQLite callback, not AX's current SQLite wrapper. [SQLite isolation](https://sqlite.org/isolation.html), [SQLite progress callbacks](https://sqlite.org/c3ref/progress_handler.html)

## Remaining verification gates

- Real PostgreSQL/MySQL integration fixtures, with server/client versions recorded
- Server timeout and client cancellation during query execution, not only stalled connection setup
- SQL compiler/evaluator differential tests for every allowed operation and dtype
- Snapshot loss, reconnect, schema drift, permission revocation, RLS visibility and opaque cursor replay
- Wide rows, decimal/money/big integer boundaries, nullable/composite keys, repeated legitimate values, skewed/high-cardinality groups and many-to-many joins
- Privacy/authorization tests before sending row text to any model and workload-specific semantic-classification evaluations
- Sustained resource bounds, slow networks, constrained disk, concurrent jobs and cold-cache behavior

No production indexes, ANALYZE, schema changes, credentials, live database reads or PostgreSQL/MySQL server executions were performed.

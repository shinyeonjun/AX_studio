# Local userlike planner lab

This is an independent implementation from base `23fc744164f9476085fa6266b3d0279ddf5c85d1`. It does not reproduce or download the unavailable Library patch.

Use Node 22. The lab creates isolated synthetic Korean orders/products/refunds in SQLite and a localhost HTTP server. It uses production `RdbConnector`, `HttpConnector`, `runAxCommandChat`, command service and runtime. The fake outbox never sends email or Slack messages. No real connection configuration or credential files are loaded.

```sh
npm ci
npm run build -w @ax-studio/core
node --test test/userlike-planner/*.test.mjs
node test/userlike-planner/run-core.mjs --scripted
node test/userlike-planner/run-plan.mjs --scripted
node test/userlike-planner/run-plan.mjs --scripted --xlsx
```

`--scripted` supplies decision fixtures only; connectors, SQLite queries, HTTP and host transformations remain real. This is not a Jev language evaluation. Results check actual row IDs/order/exclusion and reopened workbook contents. `run-plan` checks actual runtime table/text outputs; `--xlsx` checks the bound read-to-export graph against every source cell. Tests cover duplicate reads, HTTP 503, in-flight and pre-aborted cancellation, the isolated fake outbox, workbook formula/template literal handling, storage failures, duplicate export, and a replay of the actual uncertain typo result that must ask again without executing.

## Authorized live runs only

```sh
node test/userlike-planner/run-core.mjs --live --steps 3 --max-http 8
node test/userlike-planner/run-core.mjs --live --from 5 --steps 1 --max-http 3
node test/userlike-planner/run-plan.mjs --live
```

Live mode reads only `TYPESAFE_API_KEY` from the environment. It preserves the injected value in HTTPS Authorization to the fixed `https://api.typesafe.ai/v1/systemone` origin through the provided `HTTPS_PROXY`. Redirects are rejected. There is no retry agent or scripted fallback. Provider request counts are reserved on disk before sending, including failed requests and adapter splits. Both the per-batch limit and the cumulative 30-request hard cap apply. HTTP 401/403 stops future requests. The ledger begins at **1** to account for the previously authorized connectivity smoke. Keep `runs/provider-budget.json`; do not reset it. A cross-process lock rejects concurrent live runs.

The current task has used **27/30** provider requests. Do not extend/reset the budget without authorization. This README is a usage snapshot; the ledger is authoritative.

The generation harness is deliberately unconfigured. If Jev requests generated prose, the lab records `blockedByGenerativeAuth`; it never substitutes a fake generated answer. A verified table can coexist with a blocked summary. Reports separate this from row correctness and from batch-budget blocking.

## Boundaries and observed limitations

- Selected catalog modules only; independent argument decisions precede dependent binding decisions. No new tool discovery or arbitrary semantic graph replanning.
- Host checks ports, required inputs, references, types and cycles. Missing write fields that existing host forms collect remain pending; runtime approvals and output validation remain authoritative.
- At most 6 evaluator phases by default, capped at 8. Only missing/invalid answers or conflicting bindings are reconsidered, and binding repair uses the original candidates. Final requirement/scope negatives or uncertainty stop command creation.
- Plan cards show metadata and dependency order only, with no inputs/actions or completion claim. Raw parameters and host-confirmed values are excluded from final review/cards.
- String/boolean equality uses at most 64 distinct values from the selected column (maximum 256 characters each). Unknown/mixed/oversized candidate sets stop.
- Excel export now uses the typed `transform.table_to_xlsx` write module (`TableArtifact` input, `JsonArtifact` containing safe artifact-reference metadata output). The host chooses its artifact store and fixed filename; the module does not accept destinations or send files. The current previous table is selected by Jev, metadata-only requirement/scope review must pass, then the existing command gateway/runtime owns persistence. It preserves current rows/order/scalar types and marks partial source coverage in a separate worksheet. Strings are literal cells, including formulas and template syntax. Runtime result metadata enables the Desktop chat's explicit download/save actions, with existing path/hash validation and no overwrite. No newly paid Jev run or native GUI test has been performed for this extension.
- Runtime direct TableArtifact output on an output port named `rows` now preserves the table rather than interpreting its internal row wrappers as a new schema. Typed table contents are not workflow template instructions.
- Actual typo request `상픔 목록 좀 보여죠` remained unverified: Jev returned an exactly uncertain tool probability, and the existing parser correctly stopped. No threshold override was added.
- Electron GUI is blocked with sandbox enabled: the existing helper is not root-owned mode 4755. The prepared wrapper disables sandbox; it was not used. No GUI success or screenshot is claimed.

Results and budgets are under ignored `runs/`; they contain synthetic data only. Do not include run data in the source patch.

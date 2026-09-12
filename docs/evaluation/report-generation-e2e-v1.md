# Report generation E2E benchmark v1

This benchmark measures the report-generation product path after source discovery has
already selected the sources. It is deliberately separate from
work-discovery-benchmark: that benchmark evaluates candidate discovery, replay
selection, clarification, and hidden holdouts; this one verifies the rendered report
that a user can download.

Each run creates its template and completed-example PDFs outside the repository. The
runner then:

1. starts a local HTTP server exposing paginated `/api/v1/orders` data;
2. provides a paginated RDB connector through the production `Connector` contract;
3. calls the production `ReportGenerationService.generate` seam;
4. uses the real `StdioDocumentEngineClient` for PDF pair analysis and PDF filling;
5. captures the example period, replays the business plan, captures the target period,
   materializes the layout, and stores the generated artifact;
6. extracts the produced PDF with PDFium in a separate verifier and compares it with
   literal gold values from `cases.mjs`.

The fixture planner is deterministic so a model-provider outage does not make a
regression metric noisy. The service, source capture, report-plan executor, layout
materializer, checkpoint writer, HTTP connector, document worker, PDF writer, and
artifact sink remain real production seams.

## Cases

The suite contains fifteen cases: six complete PDFs and nine expected safe failures.
Each case carries a Korean natural-language goal, but the planner is intentionally
deterministic; the suite measures the report execution boundary, not an LLM's
semantic interpretation of the request.

| Case | Expected result | What it protects |
| --- | --- | --- |
| `complete-api-db-report` | PDF succeeds | REST pagination, RDB pagination, API/DB join, scalar KPIs, customer table, output artifact |
| `dynamic-row-extension` | PDF succeeds | target has one more table row than the example; safe geometry extension must retain every row |
| `deep-pagination-replay` | PDF succeeds | one-row HTTP and RDB pages, complete capture across many pages |
| `nested-http-envelope` | PDF succeeds | explicit nested `rowsPath` and nested pagination metadata |
| `natural-language-goal` | PDF succeeds | colloquial user instruction reaches the production service without changing the bounded plan |
| `source-order-invariance` | PDF succeeds | source row order does not change sorted customer output or KPI values |
| `safe-failure-layout-capacity` | no PDF | an unsafe target overflow must fail closed with `report_table_capacity_exceeded` |
| `safe-failure-empty-target` | no PDF | zero-denominator periods fail with `report_division_by_zero` instead of a misleading artifact |
| `safe-failure-http-page-mismatch` | no PDF | a provider page that reports the wrong page identity is rejected |
| `safe-failure-http-no-progress` | no PDF | repeated REST pages are not counted twice |
| `safe-failure-http-service-unavailable` | no PDF | HTTP 503 is surfaced as a source failure rather than replaced with guessed data |
| `safe-failure-http-invalid-json` | no PDF | a 200 response with a non-JSON body is rejected |
| `safe-failure-rdb-incomplete` | no PDF | an incomplete RDB page without a usable continuation is rejected |
| `safe-failure-rdb-no-progress` | no PDF | repeated RDB pages are not aggregated twice |
| `safe-failure-join-cardinality` | no PDF | duplicate customer identities do not silently select one contract target |

Gold values are written as literal expected strings and rows. They are not calculated by
`executeReportPlan`, the layout materializer, or the generated PDF.

## Metrics

The report contains:

- `e2eSuccessRate`: successful positive cases divided by positive cases;
- `replayPassRate`: positive cases where the service verified the completed example;
- `outputCompletenessRate`: mean fraction of expected target rows present in the PDF;
- `templateFidelityRate`: one-page output plus required benchmark markers;
- `safeFailureRate`: negative cases that produced no artifact and the expected error;
- `categories`: the independent behavior categories covered by the run;
- `latencyMs` for all cases, plus `positiveLatencyMs` and
  `safeFailureLatencyMs` so expected failures do not make artifact-generation
  latency look artificially fast; per-stage p50/p95 values;
- HTTP request and RDB page counts, so pagination is observable rather than inferred;
- `positiveCaseCount` and `negativeCaseCount`, so a high rate cannot hide a
  suite that has drifted back to a handful of smoke cases.

The default output is `D:\ax\_test\report-generation-e2e\latest.json` on Windows (or a
system temporary directory on other platforms). No generated file is written to the
repository.

## Running

```powershell
npm run build -w @ax-studio/core
npm run test:report-e2e
node test/report-generation-e2e/verify-report.mjs
```

The contract-only check does not start a server or document worker:

```powershell
node test/report-generation-e2e/run.mjs --check-contract
```

Use `AX_REPORT_E2E_ROOT` or `--root=...` to choose another output directory. Run one
case with `--case=complete-api-db-report`.

## Boundary and limitations

The HTTP server and RDB fixture are local deterministic adapters; they do not claim to
measure a remote provider or a particular PostgreSQL installation. The existing
connector integration suite remains responsible for real PostgreSQL/MySQL driver
behavior. Likewise, the benchmark does not measure an LLM's semantic plan discovery:
the Work Discovery benchmark and provider-specific evaluations cover that boundary.
Korean labels are included in the generated form; independent gold assertions use
stable ASCII values because PDF text extraction varies by installed Windows font
encoding. The natural-language cases therefore keep Korean in the request boundary
while retaining portable report gold values.

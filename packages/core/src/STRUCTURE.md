# Core package layout

AX Core is organized around **contracts → catalog → modules → runtime → workflow**.

```text
packages/core/src/

contracts/          Shared data contracts (Zod schemas, neutral interfaces)
  artifacts/        FileRef, DocumentArtifact, TableArtifact, table-build helpers
  discovery-source.ts  Module-owned discovery source provider interface
  refs/             EmailMessageRef, SlackChannelRef, ...
  capability-io.ts  CapabilityIO type names
  compatibility.ts  output → input contract matching rules
  mappers.ts        FileRef ↔ document.ingest param mapping

catalog/            Discovery surface (no connector implementations)
  capabilities.ts   Capability catalog aggregation
  capability-resolver.ts  Pure connector/action -> packaged capability resolution
  capability-graph.ts
  connectors.ts     Connectable connector metadata (CONNECTOR_CATALOG)

modules/            Connector implementations (modules do not import each other)
  {connector}/      Per-module catalog.ts + connector implementation
  gmail/
  slack/
  local-folder/
  document/         Document connector (read/ + write/ subdirs)
  rdb/
  local-sheet/
  transform/        Contract adapters (table/document → text) + transform.evaluate
  http/
  webhook/
  mocks/            Test-only connector implementations
  test-connectors.ts Test-only deterministic connector assembly
  module-registry.ts  registerModule() API
  packages/         ModulePackage assembly + explicit registerAllModules()
  registry.ts       Runtime connector instantiation

workflow/           Workflow IR, approval policy, visual display, canvas authoring
  canvas/           Natural-language workflow authoring (canonical)
    draft/          Canvas schema and action instances
    compile/        WorkflowCanvasDraft → WorkflowIR
    presentation/   Summaries and panel fields
    revision/       Execution explanation summaries
    test/           Compiler and canvas tests
  transform-expr/   Reusable TransformExpr DSL + evaluator (workflow-level primitive)

work-discovery/     Example-driven workflow discovery pipeline
  sources/          DiscoverySourceProvider registry (module-owned providers)
  observation/      Document/Workbook/Table observers
  exploration/      Source inventory + ranking
  synthesis/        Candidate enumeration + ALL-pass replay
  compile/          Blueprint + compileBlueprintToWorkflow (canPublish is sole gate)
  clarification/    Scoped clarification questions
  e2e/              North-star integration tests

document-engine/    Document **read** engine TS client → Python sidecar
document-write/     Document **write** engine (HTML, PDF, DOCX generation)
paths/              AxDataPaths — unified local data layout (AX_DATA_ROOT)

triggers/           Trigger transport (poll/push) — domain events only
runtime/            Execution engine, scheduler, trigger engine
design-tools/       Read-only agent design tools
agent/              AI harness, skills, model providers
  embedded.ts       GENERATED — skill markdown embedded at build time
store/              SQLite persistence
credentials/
testing/            Test-only fixtures (not public API)
```

## Principles

1. **Modules do not know each other** — only shared `contracts/` types and neutral helpers.
2. **Module metadata is module-owned** — each `modules/{connector}/catalog.ts` owns capabilities; `packages/catalog-data.ts` only aggregates.
3. **Explicit bootstrap** — `registerAllModules()` is called from `bootstrap.ts`, not import side effects.
4. **Work Discovery stays connector-agnostic** — source materialization goes through `DiscoverySourceProvider` on module packages.
5. **TransformExpr is workflow-level** — `workflow/transform-expr/` is reused by modules/transform and work-discovery synthesis.
6. **Canvas is canonical NL authoring** — `workflow/canvas/` replaced the legacy `interview/` namespace.
7. **Triggers are start nodes** — output a contract; transport stays in `triggers/`.
8. **Read vs write** — `document-engine/` (parse) + `document-write/` (generate).

## Architecture checks

```bash
npm run arch:check   # dependency-cruiser rules (repo root)
npm run knip         # unused files/exports/deps
```

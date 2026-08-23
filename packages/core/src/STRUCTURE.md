# Core package layout

AX Core is organized around **contracts → catalog → modules → runtime**.

```text
packages/core/src/

contracts/          Shared data contracts (Zod schemas)
  artifacts/        FileRef, DocumentArtifact, TextArtifact, ...
  refs/             EmailMessageRef, SlackChannelRef, ...
  capability-io.ts  CapabilityIO type names
  compatibility.ts  output → input contract matching rules
  mappers.ts        FileRef ↔ document.ingest param mapping

catalog/            Discovery surface (no connector implementations)
  capabilities.ts   Capability catalog
  capability-resolver.ts  Pure connector/action -> packaged capability resolution
  capability-graph.ts
  connectors.ts       Connectable connector metadata (CONNECTOR_CATALOG)

modules/            Connector implementations (modules do not import each other)
  gmail/
  slack/
  local-folder/
    resources.ts    Connector-owned folder/file snapshots
  document/         Document connector (read/ + write/ subdirs)
  rdb/
  transform/        Contract adapters (table/document → text)
  mocks/             Test-only connector implementations (never production bootstrap)
  test-connectors.ts Test-only deterministic connector assembly
  stubs/            Reserved directories for connectors not implemented in v1
  module-registry.ts  registerModule() API
  register-defaults.ts  Built-in module registration
  registry.ts       Runtime connector instantiation
  types.ts          Connector interface

document-engine/    Document **read** engine TS client → Python sidecar
document-write/     Document **write** engine (HTML, PDF, DOCX generation)
paths/              AxDataPaths — unified local data layout (AX_DATA_ROOT)

triggers/           Trigger transport (poll/push) — domain events only
  gmail/new-message/
  slack/new-message/
  local-folder/new-file/
  stubs/webhook/    Reserved for a future webhook transport; no runtime code

workflow/           Workflow IR, approval policy, visual display, contract-validator, contract-adapters
  control-flow.ts   Graph/contract sequence helpers; runtime and contract linearization are separate
  port-binding.ts   Shared binding contract independent of binding inference
  action-instance.ts Persisted action instance contract independent of canvas state
runtime/            Execution engine, scheduler, trigger engine
  param-resolution.ts Explicit template/ref resolution immediately before connector calls
interview/          Legacy-named workflow canvas compatibility module
  draft/            Canvas schema and action instances
  compile/          InterviewDraft → WorkflowIR
  slots/            Node slot IDs and requiredness
  presentation/     Summaries and documents
  revision/         Execution explanation and revision-facing summaries
  test/             Compiler and canvas tests
design-tools/       Read-only agent design tools and tool execution boundary
agent/              AI harness, role skills, connector domain skills, model providers
  skills/           role skills + gmail/slack/document/rdb/local-folder/transform domain skills
store/              SQLite persistence
credentials/
nodes/              Reserved for future generic workflow nodes; no runtime code
```

## Principles

1. **Modules do not know each other** — only shared `contracts/` types.
2. **Triggers are start nodes** — output a contract; transport stays in `triggers/`.
3. **Commands are the agent surface** — the Agent requests validated commands; the catalog remains the authoritative action contract.
4. **Read vs write** — `document-engine/` (parse) + `document-write/` (generate); `modules/document/read|write/` are thin workflow adapters.

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
  capability-graph.ts
  connectors.ts       Connectable connector metadata (CONNECTOR_CATALOG)

modules/            Connector implementations (modules do not import each other)
  gmail/
  slack/
  local-folder/
  document/         Document read/write connector (PDF, HTML, DOCX, ...)
  rdb/
  transform/        Contract adapters (table/document → text)
  mocks/
  stubs/            Placeholder modules (http, storage, google-*, file)
  module-registry.ts  registerModule() API
  register-defaults.ts  Built-in module registration
  registry.ts       Runtime connector instantiation
  types.ts          Connector interface

document-engine/    Python document engine client (separate from modules/document)

triggers/           Trigger transport (poll/push) — domain events only
  gmail/new-message/
  slack/new-message/
  local-folder/new-file/
  stubs/webhook/

workflow/           Workflow IR, approval policy, visual display, contract-validator, contract-adapters
runtime/            Execution engine, scheduler, trigger engine
interview/          Workflow design interview
design-tools/       Agent design-time discovery tools
agent/              AI harness, skills, model providers
store/              SQLite persistence
credentials/
nodes/              Future generic workflow nodes (transform, flow, state)
```

## Principles

1. **Modules do not know each other** — only shared `contracts/` types.
2. **Triggers are start nodes** — output a contract; transport stays in `triggers/`.
3. **Catalog is the agent surface** — capabilities + connector metadata for discovery.
4. **`document-engine/` vs `modules/document/`** — engine client vs workflow connector.

# Core package layout

AX Core is organized by product capability. Each top-level directory is a
cohesive boundary with a small public seam; implementations stay behind that
seam and connector adapters do not import one another.

```text
packages/core/src/

contracts/           Shared neutral contracts and artifact/reference schemas
catalog/             Capability metadata, resolution, and connector catalog data
connectors/          External-system adapters and connector package assembly
  {connector}/       One adapter boundary per connector
  document/read/     Document connector read actions
  document/write/    Document connector write actions
  protocols/mcp/     MCP protocol adapter
  protocols/openapi/ OpenAPI protocol adapter
  packages/          Explicit connector package registration

workflow/            Workflow IR, canvas authoring, validation, repair, and display
work-discovery/      Source observation, exploration, synthesis, and publication
runtime/             Execution engine, scheduling, approvals, and trigger runtime
triggers/            Poll/push transport and trigger registration

documents/read/      TypeScript client for the Python document engine
documents/write/     HTML, PDF, and DOCX generation contracts and writers
documents/reporting/ Report planning, source capture, and report assembly

persistence/         SQLite stores, repositories, credentials, paths, and artifacts
intelligence/        Agent boundary, design tools, retrieval, and model providers
platform/             Host/platform integration primitives
application/         Application composition and bootstrap entry point

testing/             Test-only fixtures, connector doubles, and e2e harnesses
eval/                Scenario catalog and evaluation suites
i18n/                Localized product strings
```

## Principles

1. **Contracts are neutral** — shared schemas never depend on a concrete connector.
2. **Connectors are isolated** — adapter code, catalogs, and registration live under `connectors/`; connector A does not know connector B.
3. **Catalog owns aggregation** — `catalog/data.ts` is the single aggregation seam; individual connector metadata remains next to its adapter.
4. **Persistence is private infrastructure** — database, credentials, paths, and artifact storage are exposed through explicit services rather than directory-level reach-through.
5. **Read vs write stays explicit** — document ingestion/read and document generation/write have separate seams, with reporting above both.
6. **Intelligence is a policy boundary** — agent prompts, skills, model providers, retrieval, and design tools stay behind `intelligence/`.
7. **Application composition is explicit** — `application/bootstrap.ts` wires services; importing a connector does not register global side effects.
8. **Root domain seams are intentional** — workflow, work-discovery, runtime, triggers, contracts, catalog, and platform remain top-level because they are stable cross-feature boundaries.

## Architecture checks

```bash
npm run arch:check   # dependency-cruiser rules (repo root)
npm run knip         # unused files/exports/deps
```

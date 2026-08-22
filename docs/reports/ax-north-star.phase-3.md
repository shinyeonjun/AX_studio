# North Star Phase 3 Report — HTTP connector

Date: 2026-08-23

## Delivered

### Core
- `packages/core/src/modules/http/` — connection config, URL SSRF guard, bounded fetch, connector
- `http.request` capability in catalog (`GET` → runtime `NONE`, other methods → `EXTERNAL` via `resolveEffectiveSideEffect`)
- `packages/core/src/workflow/side-effect-resolve.ts` — method-based side effect for `http.request`
- Module package `packages/core/src/modules/packages/http.ts`

### Security defaults
- Requests constrained to connection `baseUrl` origin + path prefix
- Blocks absolute URLs, protocol-relative URLs, path traversal outside base
- `redirect: 'manual'` (no follow)
- 30s timeout, 1MB response cap

### Desktop
- Settings → API → HTTP API connection form
- IPC: `ax:connectHttp`, `ax:disconnectHttp`
- OS secret store for tokens/passwords (`http.auth`)
- `hydrateHttpConnector` on app start

## Verification

- `url-security.test.ts`, `connector.test.ts`, `side-effect-resolve.test.ts`
- Full core suite: 363 passed
- `npm run build` pass

## Key files

| Area | Path |
|------|------|
| Connector | `packages/core/src/modules/http/connector.ts` |
| SSRF | `packages/core/src/modules/http/url-security.ts` |
| Fetch | `packages/core/src/modules/http/request.ts` |
| Catalog | `packages/core/src/modules/packages/catalog-data.ts` |
| Desktop IPC | `apps/desktop/electron/main/http/connection.ts` |
| UI | `apps/desktop/src/components/settings/connectors/HttpConnectionForm.tsx` |

## Not in scope (Phase 4+)

- Webhook inbound trigger
- OpenAPI ingest (Phase 9)

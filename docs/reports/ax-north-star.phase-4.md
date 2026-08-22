# North Star Phase 4 Report — Webhook trigger

Date: 2026-08-23

## Delivered

### Core
- `webhook.inbound` trigger type in workflow schema
- `packages/core/src/triggers/webhook/` — localhost listener, shared secret / HMAC signature, payload size cap (256KB)
- Push trigger driver on `webhook` module package — integrates with existing `TriggerEngine`
- **Enabled workflows only** — inactive rows ignored (existing `skill.active` gate)
- Payload exposed to runs as trigger input (`path`, `body`, `headers`, `requestId`, `receivedAt`)
- `setWebhookSecretResolver` for desktop OS secret store

### Security
- Bind `127.0.0.1` only
- `POST /hooks/{path}` only
- Auth via `X-AX-Webhook-Secret`, `Authorization: Bearer`, or `X-AX-Signature: sha256=…`
- No webhook knowledge tool (trigger-only)

### Desktop
- Settings → API → Webhook (port, secret, tunnel URL reference)
- IPC: `ax:connectWebhook`, `ax:disconnectWebhook`
- Listener refresh on connect/disconnect

## Verification

- `security.test.ts`, `listener.test.ts`
- `trigger-engine.test.ts` — enabled runs, disabled ignores
- Full core: **370 passed**
- `npm run build` pass

## Key files

| Area | Path |
|------|------|
| Listener | `packages/core/src/triggers/webhook/listener.ts` |
| Security | `packages/core/src/triggers/webhook/security.ts` |
| Module | `packages/core/src/modules/packages/webhook.ts` |
| Schema | `packages/core/src/workflow/schema.ts` |
| Desktop | `apps/desktop/electron/main/webhook/connection.ts` |

## Next (Phase 5)

- Slack read as knowledge (`Citation` / `SourceRef`)

# North Star Phase 5 Report — Slack read as knowledge

Date: 2026-08-23

## Delivered

### Slack read capabilities
- `slack.channels.list` — accessible channels (NONE)
- `slack.messages.search` — workspace search with `SearchHit` + `Citation`
- `slack.messages.read` — recent channel history (NONE)
- `slack.message.send` unchanged (EXTERNAL write gate)

### Implementation
- `packages/core/src/modules/slack/read.ts` — Slack Web API reads
- `packages/core/src/modules/slack/channel-resolve.ts` — shared channel id resolution
- `packages/core/src/platform/citations.ts` — `Citation` / `SearchHit` helpers

### Plain-chat surface
- Design tool **`capabilities.invoke`** — read-only capabilities with sideEffect policy
- Returns `{ capabilityId, data, citations, untrusted }`
- Desktop passes `runtime.connectors` into design-tool context
- Cloud providers still require local AI for untrusted body (`source_content_requires_local_ai`)

## Verification

- `modules/slack/slack-read.test.ts` — mock search + invoke + write block
- Full core: **373 passed**
- `npm run build` PASS

## Key files

| Area | Path |
|------|------|
| Read actions | `packages/core/src/modules/slack/read.ts` |
| Invoke tool | `packages/core/src/design-tools/tools/capabilities-invoke.ts` |
| Citations | `packages/core/src/platform/citations.ts` |
| Catalog | `packages/core/src/modules/packages/catalog-data.ts` |

## Next (Phase 6)

- Local retrieval index for large sources

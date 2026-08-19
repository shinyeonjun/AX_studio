/**
 * Webhook trigger — external push into AX Studio.
 *
 * Planned trigger type: webhook.receive
 * Planned capability: webhook.receive (trigger kind)
 *
 * Flow: external service → webhook → AI decide → DB/Slack/Gmail
 *
 * Desktop constraint: public endpoint needs Gateway/tunnel later.
 * v1: define TriggerSchema + handler interface only; remote ingress deferred.
 *
 * Register: triggers/registry.ts, workflow/schema.ts TriggerSchema
 *
 * @see ../../nodes/README.md
 */
export {};

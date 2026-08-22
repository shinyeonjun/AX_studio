import { invokeReadCapability } from '../capability-invoke.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

function requiredCapabilityId(args: Record<string, unknown>): string {
  const id = args.id;
  if (typeof id !== 'string' || !id.trim()) throw new Error('capability_id_required');
  return id.trim();
}

function paramsArg(args: Record<string, unknown>): Record<string, unknown> {
  const value = args.params;
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('params_invalid');
  return value as Record<string, unknown>;
}

/** Invoke a read-only capability (e.g. Slack search/read) with citation metadata. */
export const capabilitiesInvoke: DesignToolHandler = async (ctx, args) => {
  const mode = ctx.interactionMode ?? (ctx.workflow ? 'authoring' : 'plain_chat');
  if (mode === 'plain_chat' && ctx.allowUntrustedData !== true) {
    throw new Error('source_content_requires_local_ai');
  }

  return invokeReadCapability(ctx, requiredCapabilityId(args), paramsArg(args), mode);
};

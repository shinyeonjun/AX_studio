import { invokeReadCapability } from '../capability-invoke.js';
import { allowsCloudPlainChatRead, sanitizeCloudReadEnvelope } from '../cloud-plain-chat-read.js';
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

export const capabilitiesInvoke: DesignToolHandler = async (ctx, args) => {
  const mode = ctx.interactionMode ?? 'plain_chat';
  const capabilityId = requiredCapabilityId(args);
  if (mode === 'plain_chat' && ctx.allowUntrustedData !== true && !allowsCloudPlainChatRead(capabilityId)) {
    throw new Error('source_content_requires_local_ai');
  }

  const envelope = await invokeReadCapability(ctx, capabilityId, paramsArg(args), mode);
  if (mode === 'plain_chat' && ctx.allowUntrustedData !== true) {
    return sanitizeCloudReadEnvelope(envelope);
  }
  return envelope;
};

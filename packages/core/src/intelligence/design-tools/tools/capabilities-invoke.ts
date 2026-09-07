import { boundCapabilityEvidence, CapabilityInvokeError, invokeReadCapability } from '../capability-invoke.js';
import { allowsCloudPlainChatRead, sanitizeCloudReadEnvelope } from '../cloud-plain-chat-read.js';
import type { DesignToolHandler } from '../types.js';

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
  const capabilityId = requiredCapabilityId(args);
  if (ctx.allowUntrustedData !== true && !allowsCloudPlainChatRead(capabilityId)) {
    throw new Error('source_content_requires_local_ai');
  }

  const envelope = await invokeReadCapability(ctx, capabilityId, paramsArg(args)).catch((error: unknown) => {
    if (!(error instanceof CapabilityInvokeError)) throw error;
    if (ctx.allowUntrustedData !== true) throw new CapabilityInvokeError('capability_invoke_failed');
    const message = error.message.length > 1_000 ? `${error.message.slice(0, 1_000)}...[truncated]` : error.message;
    if (error.errorDetails === undefined) throw new CapabilityInvokeError(message);
    const details = boundCapabilityEvidence({ capabilityId, data: error.errorDetails, citations: [], untrusted: true });
    const errorDetails = details.evidence?.truncated
      ? { preview: details.data, truncated: true }
      : details.data;
    throw new CapabilityInvokeError(message, errorDetails);
  });
  if (ctx.allowUntrustedData !== true) {
    return boundCapabilityEvidence(sanitizeCloudReadEnvelope(envelope));
  }
  return boundCapabilityEvidence(envelope);
};

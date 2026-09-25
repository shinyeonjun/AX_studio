import { getCapability } from '../catalog/capabilities.js';
import { capabilityActionName, readCapabilityMethodIssue } from '../catalog/capability-graph.js';
import { connectorFailureKind } from '../connectors/failure-kind.js';
import type { Connector, ConnectorContext, ConnectorFailureKind, ConnectorResult } from '../connectors/types.js';
import { materializeStepOutputs } from './output-ports.js';

export class CapabilityReadFailure extends Error {
  constructor(
    readonly errorCode: string,
    readonly failureKind: ConnectorFailureKind,
  ) {
    super('capability_read_failed');
    this.name = 'CapabilityReadFailure';
  }
}

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,159}$/iu.test(value)
    ? value
    : undefined;
}

export async function performCapabilityRead(
  capabilityId: string,
  ctx: ConnectorContext,
  connectors: Record<string, Connector>,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const cap = getCapability(capabilityId);
  if (!cap || cap.kind !== 'read') {
    throw new CapabilityReadFailure('capability_not_readable', 'host_policy');
  }
  const methodIssue = readCapabilityMethodIssue(cap, params);
  if (methodIssue) throw new CapabilityReadFailure(safeErrorCode(methodIssue) ?? 'read_method_rejected', 'host_policy');

  const connector = connectors[cap.connector];
  if (!connector) throw new CapabilityReadFailure('connector_not_available', 'unknown');

  const action = capabilityActionName(cap);
  let result: ConnectorResult;
  try {
    result = await connector.execute(action, params, ctx);
  } catch (error) {
    ctx.abortSignal?.throwIfAborted();
    const rawCode = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    const code = safeErrorCode(rawCode) ?? 'connector_exception';
    throw new CapabilityReadFailure(code, connectorFailureKind(
      typeof rawCode === 'string' ? rawCode : undefined,
      error,
    ));
  }
  ctx.abortSignal?.throwIfAborted();
  if (!result.ok) {
    throw new CapabilityReadFailure(
      safeErrorCode(result.errorCode) ?? 'connector_failed',
      connectorFailureKind(result.errorCode, result.errorDetails),
    );
  }
  return cap.io?.outputs
    ? materializeStepOutputs(`capability:${capabilityId}`, cap.io.outputs, result.data)
    : result.data;
}

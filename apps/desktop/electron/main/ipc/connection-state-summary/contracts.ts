import type { PushTransportState } from '@ax-studio/core';

export interface ConnectionSummaryOptions {
  webhookTransport?: PushTransportState;
}

export type ConnectionSummaryEntry = {
  connector: string;
  connected: boolean;
  config?: Record<string, unknown>;
};

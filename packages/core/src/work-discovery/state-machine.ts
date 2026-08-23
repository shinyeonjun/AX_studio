import type { DiscoveryStatus } from './schema.js';

const TRANSITIONS: Record<DiscoveryStatus, DiscoveryStatus[]> = {
  collecting_examples: ['observing_output', 'cancelled', 'failed'],
  observing_output: ['inventory_sources', 'cancelled', 'failed'],
  inventory_sources: ['exploring_sources', 'cancelled', 'failed'],
  exploring_sources: ['synthesizing', 'cancelled', 'failed'],
  synthesizing: ['validating', 'cancelled', 'failed'],
  validating: ['needs_clarification', 'ready_to_publish', 'failed', 'cancelled'],
  needs_clarification: ['synthesizing', 'cancelled', 'failed'],
  ready_to_publish: ['publishing', 'cancelled'],
  publishing: ['published', 'failed'],
  published: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: DiscoveryStatus, to: DiscoveryStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: DiscoveryStatus, to: DiscoveryStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid_discovery_transition:${from}->${to}`);
  }
}

export function isTerminalStatus(status: DiscoveryStatus): boolean {
  return status === 'published' || status === 'failed' || status === 'cancelled';
}

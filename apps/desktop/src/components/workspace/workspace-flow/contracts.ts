import type { DiscoveryInspectView, WorkspaceChatMessage } from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../../../hooks/useWorkspaceChat.js';

export type FlowStatus = 'idle' | 'running' | 'review' | 'approval' | 'success' | 'cancelled' | 'error';

export type DiscoveryFlowState = Pick<DiscoveryInspectView, 'status' | 'progress' | 'replaySummary'>;

export interface WorkspaceFlowPanelProps {
  messages: WorkspaceChatMessage[];
  busy: boolean;
  discoveryBusy?: boolean;
  progress: string;
  error?: string;
  discovery?: DiscoveryFlowState;
  workflow?: WorkspaceWorkflowState | null;
}

export interface WorkspaceFlowPresentation {
  status: FlowStatus;
  statusLabel: string;
  activeStage: number;
  message: string;
}

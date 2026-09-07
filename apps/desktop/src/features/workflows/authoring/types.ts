export type WorkflowVisualKind =
  | 'trigger'
  | 'action'
  | 'ai_decision'
  | 'if'
  | 'human_approval'
  | 'join'
  | 'placeholder'
  | 'system';

export type WorkflowNodeChange = 'unchanged' | 'added' | 'modified';

export interface WorkflowVisualLine {
  text: string;
  complete: boolean;
}

/** Minimal card copy for graph nodes (mockup-style). */
export type WorkflowCardBrandStyle = 'bracket' | 'plain' | 'ai';

export interface WorkflowCardDisplay {
  header: string;
  brand: string;
  brandStyle: WorkflowCardBrandStyle;
  /** Primary one-line label under the icon. */
  summary: string;
  /** Optional secondary line (e.g. AI target filter). */
  captionSub?: string;
}

export interface WorkflowVisualNodeData {
  kind: WorkflowVisualKind;
  label: string;
  subtitle?: string;
  lines: WorkflowVisualLine[];
  incomplete: boolean;
  /** Connector/trigger image when available (gmail, slack, folder, document, …). */
  iconSrc?: string;
  /** Emoji fallback when no brand image exists. */
  iconEmoji?: string;
  /** Tooltip for hover; full detail in NodeDetailPanel. */
  tooltip?: string;
  /** Card layout fields for graph preview. */
  card?: WorkflowCardDisplay;
  /** Original workflow node id for edit targeting. */
  sourceId?: string;
  conditionLabel?: string;
  change?: WorkflowNodeChange;
  /** Runtime-injected helper step (e.g. Gmail body read). */
  systemInjected?: boolean;
  collapsed?: boolean;
  /** Stagger index for enter animation. */
  enterIndex?: number;
  [key: string]: unknown;
}

/** Kind badge + border styling (generic, not workflow-specific). */
export const WORKFLOW_KIND_BADGE: Partial<Record<WorkflowVisualKind, string>> = {
  trigger: 'Trigger',
  system: '자동',
  ai_decision: 'AI',
  if: 'IF',
  human_approval: '승인',
};
export const WORKFLOW_NODE_WIDTH = 136;
export const WORKFLOW_NODE_HEIGHT = 112;
export const WORKFLOW_NODE_CIRCLE = 48;
export const WORKFLOW_JOIN_SIZE = 12;

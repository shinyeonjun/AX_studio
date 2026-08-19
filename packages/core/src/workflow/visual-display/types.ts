export interface WorkflowVisualLine {
  text: string;
  complete: boolean;
}

export type WorkflowCardBrandStyle = 'bracket' | 'plain' | 'ai';

export interface WorkflowCardDisplay {
  header: string;
  brand: string;
  brandStyle: WorkflowCardBrandStyle;
  summary: string;
  captionSub?: string;
}

export interface TriggerDisplayResult {
  label: string;
  lines: WorkflowVisualLine[];
  tooltip?: string;
  iconConnector?: string;
  card: WorkflowCardDisplay;
}

export interface TriggerDisplay extends TriggerDisplayResult {
  subtitle?: string;
  incomplete: boolean;
}

export interface NodeDisplayResult {
  kind: 'action' | 'ai_decision' | 'if' | 'human_approval';
  label: string;
  subtitle?: string;
  lines: WorkflowVisualLine[];
  incomplete: boolean;
  conditionLabel?: string;
  iconConnector?: string;
  tooltip?: string;
  card: WorkflowCardDisplay;
}

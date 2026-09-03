import type { WorkflowCanvasDraft } from '../../draft/schema.js';
import type { CompletenessResult } from '../../slots/types.js';
import { aiDecisionPanelFields, actionPanelFields } from './nodes.js';
import { triggerPanelFields } from './triggers.js';
import type { PanelField } from './types.js';

export function panelFieldsForSource(
  draft: WorkflowCanvasDraft | undefined,
  sourceId: string,
  completeness: CompletenessResult | undefined,
): PanelField[] {
  if (!draft || !completeness) return [];
  if (sourceId === '__trigger__') return triggerPanelFields(draft, completeness);

  const node = draft.nodes.find((entry) => entry.id === sourceId);
  if (!node) return [];

  switch (node.type) {
    case 'action':
      return actionPanelFields(draft, node, completeness);
    case 'ai_decision':
      return aiDecisionPanelFields(node, completeness);
    default:
      return [];
  }
}

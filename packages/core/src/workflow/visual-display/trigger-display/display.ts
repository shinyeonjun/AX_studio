import { getCapability } from '../../../catalog/capabilities.js';
import type { CompletenessResult } from '../../canvas/slots/requiredness.js';
import type { WorkflowCanvasDraft } from '../../canvas/draft/schema.js';
import { capabilityTriggerDisplay } from './capability.js';
import { staticTriggerDisplay } from './static.js';
import { triggerParamValues } from './values.js';
import type { TriggerDisplay, TriggerDisplayResult } from '../types.js';

function triggerLabel(draft: WorkflowCanvasDraft, slots?: CompletenessResult['slots']): TriggerDisplayResult {
  const values = triggerParamValues(draft);
  const staticDisplay = staticTriggerDisplay(draft, values, slots);
  if (staticDisplay) return staticDisplay;
  if (!draft.triggerType) return staticDisplay!;

  const cap = getCapability(draft.triggerType);
  if (!cap) {
    return {
      label: draft.triggerType,
      lines: [],
      tooltip: draft.triggerType,
      card: {
        header: 'Trigger',
        brand: 'Trigger',
        brandStyle: 'bracket',
        summary: draft.triggerType,
      },
    };
  }
  return capabilityTriggerDisplay(draft, cap, values, slots);
}

export function displayForTrigger(
  draft: WorkflowCanvasDraft,
  slots?: CompletenessResult['slots'],
): TriggerDisplay {
  const base = triggerLabel(draft, slots);
  const incomplete = base.lines.some((line) => !line.complete);
  return { ...base, incomplete };
}

export function editPromptForTrigger(): string {
  return '언제 이 업무를 시작할지 어떻게 바꿀까요?';
}

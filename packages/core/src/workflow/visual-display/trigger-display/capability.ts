import { getConnectorLabel } from '../../../catalog/connectors.js';
import { safeFormatCondition } from '../../../runtime/condition-expr.js';
import type { CompletenessResult } from '../../canvas/slots/requiredness.js';
import type { WorkflowCanvasDraft } from '../../canvas/draft/schema.js';
import { primaryParamValue, truncate, triggerLines } from '../helpers.js';
import type { TriggerDisplayResult } from '../types.js';
import type { TriggerParamValues } from './values.js';
import type { ConnectorCapability } from '../../../catalog/capability-types.js';

export function capabilityTriggerDisplay(
  draft: WorkflowCanvasDraft,
  cap: ConnectorCapability,
  values: TriggerParamValues,
  slots?: CompletenessResult['slots'],
): TriggerDisplayResult {
  const lines = triggerLines(cap, values, slots);
  if (draft.triggerFilter) {
    lines.push({ text: `조건: ${safeFormatCondition(draft.triggerFilter)}`, complete: true });
  }
  const primary = primaryParamValue(cap, values);
  const summary = primary ? truncate(primary, 24) : truncate(cap.label, 24);
  const detail = lines.map((line) => line.text).join(' · ');

  return {
    label: getConnectorLabel(cap.connector),
    lines,
    tooltip: detail ? `${cap.label} · ${detail}` : cap.label,
    iconConnector: cap.connector,
    card: {
      header: 'Trigger',
      brand: getConnectorLabel(cap.connector),
      brandStyle: cap.connector === 'slack' ? 'plain' : 'bracket',
      summary,
      captionSub: primary && primary !== summary ? truncate(primary, 22) : undefined,
    },
  };
}

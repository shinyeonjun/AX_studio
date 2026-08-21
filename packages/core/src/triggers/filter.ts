import { evaluateCondition } from '../runtime/condition-expr.js';
import type { Trigger } from '../workflow/schema.js';
import type { TriggerEvent } from './types.js';

/** Evaluate an event filter before the workflow runtime reads or mutates any data. */
export function matchesTriggerFilter(trigger: Trigger, event: TriggerEvent): boolean {
  if (!trigger.filter) return true;
  try {
    return evaluateCondition(trigger.filter, event.payload, {});
  } catch {
    return false;
  }
}

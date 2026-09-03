import type { Step } from '../../schema.js';

export function isConcreteParamValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('{{');
}

export function isDeferredParamValue(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).ref === 'string' &&
      String((value as Record<string, unknown>).ref).trim(),
  );
}

export function paramValueForInputPort(
  step: Extract<Step, { type: 'action' }>,
  inputPort: string,
): unknown {
  if (inputPort === 'source') return step.params?.path ?? step.params?.file;
  if (inputPort === 'message') return step.params?.messageId ?? step.params?.message;
  return step.params?.[inputPort];
}

export function hasConcreteParamForPort(
  step: Extract<Step, { type: 'action' }>,
  inputPort: string,
): boolean {
  const value = paramValueForInputPort(step, inputPort);
  if (inputPort === 'source') {
    return isConcreteParamValue(value) || Boolean(step.params?.file) || isDeferredParamValue(value);
  }
  return isConcreteParamValue(value) || isDeferredParamValue(value);
}

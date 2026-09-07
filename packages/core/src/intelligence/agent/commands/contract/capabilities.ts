import {
  designCapabilities,
  isConnectorAlwaysOn,
} from '../../../../catalog/index.js';

export function summarizeCapability(cap: ReturnType<typeof designCapabilities>[number], connected: string[], depth: 'summary' | 'schema' = 'schema') {
  return {
    id: cap.id,
    connector: cap.connector,
    kind: cap.kind,
    label: cap.label,
    description: depth === 'summary' ? cap.description.slice(0, 500) : cap.description,
    sideEffect: cap.sideEffect ?? 'NONE',
    notification: cap.notification === true,
    ...(depth === 'schema' ? { params: cap.params.map((param) => ({
      name: param.name,
      label: param.label,
      required: param.required,
    })),
    io: cap.io ?? { inputs: {}, outputs: {} } } : {}),
    connection:
      isConnectorAlwaysOn(cap.connector) || connected.includes(cap.connector)
        ? 'ready'
        : 'required',
  };
}

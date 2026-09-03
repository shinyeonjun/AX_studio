import {
  designCapabilities,
  isConnectorAlwaysOn,
} from '../../../catalog/index.js';

export function summarizeCapability(cap: ReturnType<typeof designCapabilities>[number], connected: string[]) {
  return {
    id: cap.id,
    connector: cap.connector,
    kind: cap.kind,
    label: cap.label,
    description: cap.description,
    sideEffect: cap.sideEffect ?? 'NONE',
    notification: cap.notification === true,
    params: cap.params.map((param) => ({
      name: param.name,
      label: param.label,
      required: param.required,
    })),
    io: cap.io ?? { inputs: {}, outputs: {} },
    connection:
      isConnectorAlwaysOn(cap.connector) || connected.includes(cap.connector)
        ? 'ready'
        : 'required',
  };
}

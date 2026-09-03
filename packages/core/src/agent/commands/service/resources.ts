import {
  designCapabilities,
  getCapability,
  isConnectorAlwaysOn,
} from '../../../catalog/index.js';
import {
  CONNECTOR_CATALOG,
  CONNECTOR_IDS,
  getConnectorLabel,
} from '../../../catalog/connectors.js';
import {
  httpEndpointsFromConnections,
  parseHttpEndpoints,
} from '../../../modules/http/connection.js';
import type {
  AxCommand,
  AxCommandIssue,
  AxCommandResult,
} from '../schema.js';
import {
  issue,
  safeHttpBaseUrl,
  summarizeCapability,
  textArg,
} from '../contract.js';
import type { AxCommandServiceState } from './contracts.js';

export function listResources(state: AxCommandServiceState) {
  const connections = new Map(
    state.store.getConnections().map((connection) => [connection.connector, connection]),
  );
  return {
    resources: CONNECTOR_IDS.map((id) => {
      const catalog = CONNECTOR_CATALOG[id];
      const connection = connections.get(id);
      const endpoints = id === 'http'
        ? httpEndpointsFromConnections(state.store.getConnections()).map((endpoint) => ({
          id: endpoint.id,
          label: endpoint.label,
          baseUrl: endpoint.baseUrl,
        }))
        : undefined;
      return {
        id,
        label: getConnectorLabel(id),
        description: catalog.description,
        connected: isConnectorAlwaysOn(id) || Boolean(connection?.connected),
        connectable: catalog.connectable,
        connectionKind: catalog.connectionKind,
        ...(endpoints ? { endpoints } : {}),
      };
    }),
  };
}

export function listHttpConnections(state: AxCommandServiceState) {
  const connection = state.store.getConnections().find((entry) => entry.connector === 'http');
  const endpoints = parseHttpEndpoints(connection?.config);
  const connected = connection?.connected === true;

  return {
    connections: endpoints.map((endpoint) => {
      const authType = endpoint.auth?.type ?? 'none';
      const authStored = endpoint.authStored === true;
      const authReady = authType === 'none' || authStored;
      return {
        id: endpoint.id,
        label: endpoint.label ?? endpoint.id,
        baseUrl: safeHttpBaseUrl(endpoint.baseUrl),
        authType,
        authStored,
        authReady,
        connected,
        usable: connected && authReady,
      };
    }),
    count: endpoints.length,
    requiresExplicitConnectionId: endpoints.length > 1,
  };
}

export function listCapabilities(state: AxCommandServiceState, command: AxCommand) {
  const connector = textArg(command, 'connector');
  const kind = textArg(command, 'kind');
  const connected = state.store
    .getConnections()
    .filter((entry) => entry.connected)
    .map((entry) => entry.connector);
  // Keep disconnected capabilities visible so the agent can distinguish
  // "this action does not exist" from "this connection is not ready".
  let capabilities = designCapabilities();
  if (connector) capabilities = capabilities.filter((entry) => entry.connector === connector);
  if (kind === 'read' || kind === 'write' || kind === 'trigger') {
    capabilities = capabilities.filter((entry) => entry.kind === kind);
  }
  return {
    capabilities: capabilities.map((entry) => summarizeCapability(entry, connected)),
    count: capabilities.length,
  };
}

export function describeCapability(
  state: AxCommandServiceState,
  command: AxCommand,
): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
  const id = textArg(command, 'id');
  if (!id) {
    return ['invalid', undefined, [issue(
      'missing_argument',
      'capability id가 필요합니다.',
      'args.id',
      undefined,
      [{
        id: 'ax-input-capability-id',
        label: 'Capability ID',
        type: 'text',
        required: true,
        reason: '확인할 capability id를 입력해 주세요.',
      }],
    )]];
  }
  const capability = getCapability(id);
  if (!capability) {
    return ['not_found', undefined, [issue(
      'capability_not_found',
      'capability를 찾을 수 없습니다: ' + id,
      'args.id',
    )]];
  }
  const connected = state.store
    .getConnections()
    .filter((entry) => entry.connected)
    .map((entry) => entry.connector);
  return ['ok', summarizeCapability(capability, connected)];
}

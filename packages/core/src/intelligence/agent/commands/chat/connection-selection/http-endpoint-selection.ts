import type { ChatMessage } from '../../../model/chat.js';
import type { JevHttpEndpointHint } from '../jev-http-endpoint.js';
import { explicitHttpPath, selectHttpEndpointForRead } from '../jev-http-endpoint.js';
import { deriveJevRequestFeatures } from '../request-features.js';
import type { AxCommand } from '../../schema.js';
import { AX_INPUT_REQUEST_MAX_OPTIONS, type AxUiPresentation } from '../../schema/interaction.js';

export function httpEndpointSelectionValue(endpointId: string): string {
  return `HTTP 연결 ID ${endpointId}를 사용해줘`;
}

export function httpEndpointSelectionPresentation(
  endpoints: readonly JevHttpEndpointHint[],
): AxUiPresentation {
  const usable = endpoints.filter((endpoint) => endpoint.usable !== false);
  const canRenderOptions = usable.length <= AX_INPUT_REQUEST_MAX_OPTIONS
    && usable.every((endpoint) => endpoint.id.length <= 256);
  const labelCounts = new Map<string, number>();
  for (const endpoint of usable) {
    const label = (endpoint.label?.trim() || endpoint.id).toLocaleLowerCase();
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const options = canRenderOptions
    ? usable.map((endpoint, index) => {
        const label = endpoint.label?.trim() || endpoint.id;
        const displayLabel = (labelCounts.get(label.toLocaleLowerCase()) ?? 0) > 1
          ? `${label} (${index + 1})`
          : label;
        return { value: endpoint.id, label: displayLabel.slice(0, 160) };
      })
    : undefined;
  return {
    title: '어떤 연결에서 조회할까요?',
    subtitle: '요청하신 정보에 맞는 API 연결을 선택해 주세요.',
    inputMode: 'individual',
    blocks: [],
    inputs: [{
      id: 'http-endpoint-id',
      label: 'API 연결',
      type: 'text',
      required: true,
      placeholder: options ? '연결을 선택해 주세요' : '연결 이름을 입력해 주세요',
      reason: options
        ? '조회에 사용할 연결을 하나 골라 주세요.'
        : usable.length > AX_INPUT_REQUEST_MAX_OPTIONS
          ? `연결이 ${usable.length}개라 목록을 표시하지 못했어요. 사용할 연결 이름을 입력해 주세요.`
          : '연결 목록을 표시하지 못했어요. 사용할 연결 이름을 입력해 주세요.',
      ...(options ? { options } : {}),
    }],
    actions: [],
  };
}

export function selectedHttpReadCommand(
  userMessage: string,
  messages: readonly ChatMessage[],
  endpoints: readonly JevHttpEndpointHint[],
): { command: AxCommand; userIntent: string } | undefined {
  const selection = userMessage.trim();
  const typedEndpointId = /^HTTP 연결 ID:\s*(.+)$/iu.exec(selection)?.[1]?.trim();
  const selectedEndpoint = endpoints
    .filter((endpoint) => endpoint.usable !== false)
    .find((endpoint) => selection === httpEndpointSelectionValue(endpoint.id)
      || Boolean(endpoint.label?.trim() && selection.toLocaleLowerCase() === endpoint.label.trim().toLocaleLowerCase())
      || Boolean(typedEndpointId && endpoint.id === typedEndpointId));
  if (!selectedEndpoint) return undefined;

  const userIntent = [...messages].slice(0, -1).reverse()
    .find((message) => message.role === 'user')?.content;
  if (!userIntent) return undefined;
  const requestedMethod = deriveJevRequestFeatures(userIntent).explicit_http_method;
  if (requestedMethod && requestedMethod !== 'GET' && requestedMethod !== 'HEAD') return undefined;
  const path = explicitHttpPath(userIntent);
  if (!path) return undefined;

  return {
    userIntent,
    command: {
      name: 'capability.invoke',
      args: {
        id: 'http.request',
        params: { method: requestedMethod ?? 'GET', path, connectionId: selectedEndpoint.id },
      },
    },
  };
}

export function httpEndpointSelectionMessage(endpoints: readonly JevHttpEndpointHint[]): string {
  const usableCount = endpoints.filter((endpoint) => endpoint.usable !== false).length;
  return usableCount > 0
    ? '요청하신 내용을 조회할 연결을 고르지 못했어요. 어떤 연결을 사용할까요?'
    : '조회에 사용할 API 연결을 찾지 못했어요. 연결 상태를 확인해 주세요.';
}

export function httpReadPathRequiredMessage(): string {
  return '연결된 API에서 요청하신 정보를 조회할 기능을 찾지 못했어요. 이 API가 제공하는 기능 목록이나 사용 설명서를 연결해 주시면 자연어로 다시 요청할 수 있어요.';
}

export function needsExplicitHttpEndpointSelection(
  message: string,
  endpoints: readonly JevHttpEndpointHint[],
): boolean {
  const usable = endpoints.filter((endpoint) => endpoint.usable !== false);
  const method = deriveJevRequestFeatures(message).explicit_http_method;
  return (!method || method === 'GET' || method === 'HEAD')
    && Boolean(explicitHttpPath(message))
    && usable.length > 1
    && !selectHttpEndpointForRead(message, usable);
}

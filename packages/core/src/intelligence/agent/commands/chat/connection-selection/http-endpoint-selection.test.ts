import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../model/chat.js';
import { AxUiPresentationSchema } from '../../schema/interaction.js';
import {
  httpEndpointSelectionPresentation,
  httpEndpointSelectionValue,
  needsExplicitHttpEndpointSelection,
  selectedHttpReadCommand,
} from './http-endpoint-selection.js';

describe('HTTP endpoint selection', () => {
  it('uses the host chooser fallback only for explicit paths with unresolved multiple endpoints', () => {
    const endpoints = [
      { id: 'billing', label: 'Billing API' },
      { id: 'inventory', label: 'Inventory API' },
    ];

    expect(needsExplicitHttpEndpointSelection('GET /orders 를 조회해줘', endpoints)).toBe(true);
    expect(needsExplicitHttpEndpointSelection('주문 정보를 확인해줘', endpoints)).toBe(false);
    expect(needsExplicitHttpEndpointSelection('Billing API에서 GET /orders 조회해줘', endpoints)).toBe(false);
    expect(needsExplicitHttpEndpointSelection('GET /orders 를 조회해줘', endpoints.slice(0, 1))).toBe(false);
  });

  it('shows every endpoint in the supported dropdown instead of hiding entries after eight', () => {
    const endpoints = Array.from({ length: 9 }, (_, index) => ({
      id: `api-${index + 1}`,
      label: `API ${index + 1}`,
    }));
    const presentation = AxUiPresentationSchema.parse(httpEndpointSelectionPresentation(endpoints));

    expect(presentation.actions).toEqual([]);
    expect(presentation.inputs[0]?.options).toHaveLength(9);
    expect(presentation.inputs[0]?.options?.at(-1)).toMatchObject({ value: 'api-9', label: 'API 9' });
  });

  it('asks for a connection name when the list is larger than the input option contract', () => {
    const presentation = httpEndpointSelectionPresentation(Array.from({ length: 201 }, (_, index) => ({
      id: `api-${index + 1}`,
    })));

    expect(presentation.inputs[0]?.options).toBeUndefined();
    expect(presentation.inputs[0]?.placeholder).toContain('이름');
    expect(presentation.inputs[0]?.reason).not.toContain('ID');
    expect(presentation.inputs[0]?.reason).toContain('201개');
    expect(AxUiPresentationSchema.safeParse(presentation).success).toBe(true);
  });

  it('distinguishes duplicate labels without exposing internal IDs', () => {
    const duplicateLabels = httpEndpointSelectionPresentation([
      { id: 'api-1', label: 'Shared API' },
      { id: 'api-2', label: 'Shared API' },
    ]);
    expect(duplicateLabels.inputs[0]?.options?.map((option) => option.label)).toEqual(['Shared API (1)', 'Shared API (2)']);

    const longIds = httpEndpointSelectionPresentation([
      { id: `api-${'x'.repeat(253)}` },
      { id: 'api-2' },
    ]);
    expect(longIds.inputs[0]?.options).toBeUndefined();
    expect(AxUiPresentationSchema.safeParse(longIds).success).toBe(true);
  });

  it('resolves the exact selected ID against the previous HTTP request', () => {
    const endpoints = [{ id: 'api-1' }, { id: 'api-10' }];
    const messages: ChatMessage[] = [
      { role: 'user', content: 'GET orders?limit=5를 조회해줘.' },
      { role: 'assistant', content: 'HTTP 연결을 선택해 주세요.' },
      { role: 'user', content: 'HTTP 연결 ID: api-10' },
    ];

    expect(selectedHttpReadCommand('HTTP 연결 ID: api-10', messages, endpoints)).toMatchObject({
      userIntent: 'GET orders?limit=5를 조회해줘.',
      command: {
        name: 'capability.invoke',
        args: {
          id: 'http.request',
          params: { method: 'GET', path: 'orders?limit=5', connectionId: 'api-10' },
        },
      },
    });
  });

  it('resolves a human-readable connection label from the follow-up', () => {
    const endpoints = [{ id: 'dummyjson', label: 'DummyJSON' }];
    const messages: ChatMessage[] = [
      { role: 'user', content: 'GET products?limit=5를 조회해줘.' },
      { role: 'assistant', content: '어떤 연결에서 조회할까요?' },
      { role: 'user', content: 'DummyJSON' },
    ];

    expect(selectedHttpReadCommand('DummyJSON', messages, endpoints)?.command.args)
      .toMatchObject({ params: { connectionId: 'dummyjson' } });
  });

  it('preserves the older canonical selection value and rejects unknown IDs', () => {
    const endpoints = [{ id: 'api-1' }, { id: 'api-10' }];
    const messages: ChatMessage[] = [
      { role: 'user', content: 'GET orders' },
      { role: 'assistant', content: 'HTTP 연결을 선택해 주세요.' },
      { role: 'user', content: httpEndpointSelectionValue('api-10') },
    ];

    expect(selectedHttpReadCommand(httpEndpointSelectionValue('api-10'), messages, endpoints)?.command.args)
      .toMatchObject({ params: { connectionId: 'api-10' } });
    expect(selectedHttpReadCommand('HTTP 연결 ID: api-100', messages, endpoints)).toBeUndefined();
  });
});

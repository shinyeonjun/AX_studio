import { describe, expect, it } from 'vitest';
import { toAnthropicMessages } from './anthropic-api.js';
import { toSdkMessages } from './openai-compatible.js';

const image = {
  data: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  pageIndex: 2,
};

describe('model vision message adapters', () => {
  it('adds image bytes to the final OpenAI-compatible user message', () => {
    const messages = toSdkMessages({ system: 'system', user: 'analyze', images: [image] });
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'analyze' },
          { type: 'image', image: image.data, mimeType: 'image/png' },
        ],
      },
    ]);
  });

  it('encodes image bytes as an Anthropic base64 image block', () => {
    const messages = toAnthropicMessages({ system: 'system', user: 'analyze', images: [image] });
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'analyze' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AQID' },
          },
        ],
      },
    ]);
  });
});

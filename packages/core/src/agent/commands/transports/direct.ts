import { AxCommandChatOutputSchema } from '../transport-contract.js';
import type { AxCommandChatTransport } from '../transport-contract.js';

/** API and local providers already return the canonical object shape. */
export const directCommandTransport: AxCommandChatTransport = {
  outputSchema: AxCommandChatOutputSchema,
  outputInstructions:
    'AX 내부 형식: command는 {name,args} 객체로, reply는 message 문자열로 반환한다.',
  normalize(value) {
    return AxCommandChatOutputSchema.parse(value);
  },
};
